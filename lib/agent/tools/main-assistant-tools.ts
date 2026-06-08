import { tool } from 'ai';
import { z } from 'zod';
import {
  listLeads,
  getLeadById,
  getConversationByLeadId,
  getVisibleMessages,
  addMessage,
  updateConversation,
  updateCriteria,
  upsertAgencyConfig,
  listListings,
  getListing,
  createListing,
  updateListing,
  listBookedViewings,
  cancelViewing,
  rescheduleViewing,
  getOrCreateLeadSteward
} from '@/lib/db';
import { deleteCalendarEvent, getAvailableSlots } from '@/lib/calendar';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import { notifyAdmins } from '@/lib/notify';
import { criterionSchema, listingSchema } from '@/lib/types';
import { formatPrice, formatSlot } from '@/lib/format';
import type { AgentContext } from './context';

// runAgentTurn is passed as a parameter to avoid circular imports
// (this file is imported by run.ts, which defines runAgentTurn)
type RunAgentTurn = (
  conversationId: string,
  message: string,
  actor: { type: 'lead_steward'; leadId: string; adminId: string; adminName: string | null } | { type: 'lead' }
) => Promise<{ reply: string }>;

export function buildMainAssistantTools(
  ctx: AgentContext,
  adminId: string,
  adminName: string | null,
  runAgentTurn: RunAgentTurn
) {
  return {
    // ─── Lead Management ────────────────────────────────────────────────────

    query_leads: tool({
      description: 'List/filter leads by status, potential, listing, or recency.',
      inputSchema: z.object({
        status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
        potential: z.enum(['hot', 'warm', 'cold']).optional(),
        listing_id: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional()
      }),
      execute: async ({ status, potential, listing_id, limit }) => {
        let leads = await listLeads();
        if (status) leads = leads.filter((l) => l.status === status);
        if (potential) leads = leads.filter((l) => l.potential_status === potential);
        if (listing_id) leads = leads.filter((l) => l.listing_id === listing_id);
        return leads.slice(0, limit ?? 20).map((l) => ({
          id: l.id,
          email: l.email,
          name: l.name,
          listing_id: l.listing_id,
          status: l.status,
          potential: l.potential_status,
          reason: l.score_reason,
          updated_at: l.updated_at
        }));
      }
    }),

    get_lead_detail: tool({
      description: "Read a lead's full profile, qualification state, and conversation messages.",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const lead = await getLeadById(lead_id);
        if (!lead) return { error: 'lead_not_found' };
        const conv = await getConversationByLeadId(lead_id);
        const messages = conv ? await getVisibleMessages(conv.id) : [];
        return {
          lead: {
            email: lead.email,
            name: lead.name,
            status: lead.status,
            potential: lead.potential_status,
            qual_values: lead.qual_values,
            score_reason: lead.score_reason,
            long_term_memory: lead.long_term_memory
          },
          conversation_id: conv?.id ?? null,
          mode: conv?.mode ?? null,
          messages: messages.slice(-20).map((m) => ({ role: m.role, content: m.content }))
        };
      }
    }),

    send_reply: tool({
      description: 'Send a message to a lead on their active channel immediately.',
      inputSchema: z.object({ lead_id: z.string(), content: z.string().min(1) }),
      execute: async ({ lead_id, content }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await addMessage({ conversation_id: conv.id, role: 'admin', content });
        await dispatchReply(conv, content);
        broadcastConversationUpdate(conv.id);
        return { ok: true, sent: true };
      }
    }),

    draft_reply: tool({
      description: 'Save a draft message to a lead (not sent). Returns the draft text for review.',
      inputSchema: z.object({ lead_id: z.string(), content: z.string().min(1) }),
      execute: async ({ lead_id, content }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await addMessage({ conversation_id: conv.id, role: 'assistant', content, is_draft: true });
        broadcastConversationUpdate(conv.id);
        return { ok: true, draft: content };
      }
    }),

    take_over: tool({
      description: "Switch a lead's conversation to manual mode — agent stops auto-replying.",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await updateConversation(conv.id, { mode: 'manual' });
        broadcastConversationUpdate(conv.id);
        return { ok: true, mode: 'manual' };
      }
    }),

    release_conversation: tool({
      description: 'Return a lead conversation to agent mode (auto-reply resumes).',
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await updateConversation(conv.id, { mode: 'agent' });
        broadcastConversationUpdate(conv.id);
        return { ok: true, mode: 'agent' };
      }
    }),

    // ─── Listing Management ─────────────────────────────────────────────────

    list_listings: tool({
      description: 'List all property listings.',
      inputSchema: z.object({}),
      execute: async () => {
        const listings = await listListings();
        return listings.map((l) => ({
          id: l.id,
          title: l.title,
          address: l.address,
          price: formatPrice(l.price),
          rooms: l.rooms,
          surface_m2: l.surface_m2,
          agent_name: l.agent_name
        }));
      }
    }),

    create_listing: tool({
      description: 'Create a new property listing.',
      inputSchema: listingSchema,
      execute: async (input) => {
        // Normalize image_url: zod schema allows undefined, but Listing type requires null
        const listing = await createListing({ ...input, image_url: input.image_url ?? null });
        return { ok: true, id: listing.id, title: listing.title };
      }
    }),

    update_listing: tool({
      description: 'Update an existing listing (price, title, description, rooms, surface, etc.).',
      inputSchema: listingSchema.partial().extend({ id: z.string() }),
      execute: async ({ id, ...fields }) => {
        const existing = await getListing(id);
        if (!existing) return { error: 'listing_not_found' };
        const updated = await updateListing(id, fields);
        return { ok: true, id: updated.id, title: updated.title };
      }
    }),

    // ─── Calendar & Viewings ────────────────────────────────────────────────

    list_viewings: tool({
      description: 'List all booked viewings across all leads.',
      inputSchema: z.object({}),
      execute: async () => {
        const viewings = await listBookedViewings();
        return viewings.map((v) => ({
          id: v.id,
          lead_id: v.lead_id,
          listing_id: v.listing_id,
          contact_email: v.contact_email,
          slot: v.confirmed_slot ? formatSlot(v.confirmed_slot.toString()) : null,
          status: v.status,
          calendar_event_id: v.calendar_event_id
        }));
      }
    }),

    cancel_viewing: tool({
      description: 'Cancel a booked viewing and delete the calendar event.',
      inputSchema: z.object({ viewing_id: z.string() }),
      execute: async ({ viewing_id }) => {
        const viewings = await listBookedViewings();
        const v = viewings.find((x) => x.id === viewing_id);
        if (!v) return { error: 'viewing_not_found' };
        if (v.calendar_event_id) {
          const listing = v.listing_id ? await getListing(v.listing_id) : null;
          const calendarId = listing?.agent_calendar_id || ctx.config.calendar_id;
          await deleteCalendarEvent({ calendarId, eventId: v.calendar_event_id });
        }
        await cancelViewing(viewing_id);
        return { ok: true, cancelled: true };
      }
    }),

    reschedule_viewing: tool({
      description: 'Reschedule a booked viewing to a new slot. Use list_available_slots first.',
      inputSchema: z.object({ viewing_id: z.string(), new_slot_iso: z.string() }),
      execute: async ({ viewing_id, new_slot_iso }) => {
        const viewings = await listBookedViewings();
        const v = viewings.find((x) => x.id === viewing_id);
        if (!v) return { error: 'viewing_not_found' };
        await rescheduleViewing(viewing_id, new_slot_iso);
        return { ok: true, new_slot: formatSlot(new_slot_iso) };
      }
    }),

    list_available_slots: tool({
      description: 'List available viewing slots for a listing.',
      inputSchema: z.object({
        listing_id: z.string(),
        count: z.number().int().min(1).max(5).optional()
      }),
      execute: async ({ listing_id, count }) => {
        const listing = await getListing(listing_id);
        if (!listing) return { error: 'listing_not_found' };
        const slots = await getAvailableSlots({
          calendarId: listing.agent_calendar_id || ctx.config.calendar_id,
          preferredTimeline: null,
          count: count ?? 3
        });
        return { slots: slots.map((iso) => ({ iso, label: formatSlot(iso) })) };
      }
    }),

    // ─── Analytics ──────────────────────────────────────────────────────────

    pipeline_summary: tool({
      description: 'Get lead pipeline counts by status and potential.',
      inputSchema: z.object({}),
      execute: async () => {
        const leads = await listLeads();
        const byStatus = leads.reduce<Record<string, number>>((acc, l) => {
          acc[l.status ?? 'unknown'] = (acc[l.status ?? 'unknown'] ?? 0) + 1;
          return acc;
        }, {});
        const byPotential = leads.reduce<Record<string, number>>((acc, l) => {
          const k = l.potential_status ?? 'unscored';
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {});
        const booked = leads.filter((l) => l.status === 'booked').length;
        const total = leads.length;
        return {
          total,
          by_status: byStatus,
          by_potential: byPotential,
          booking_rate: total > 0 ? `${Math.round((booked / total) * 100)}%` : '0%'
        };
      }
    }),

    weekly_report: tool({
      description: 'Summary of the last 7 days: new leads, bookings, handoffs.',
      inputSchema: z.object({}),
      execute: async () => {
        const leads = await listLeads();
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recent = leads.filter((l) => l.created_at && new Date(l.created_at) >= cutoff);
        const viewings = await listBookedViewings();
        const recentViewings = viewings.filter(
          (v) => v.created_at && new Date(v.created_at) >= cutoff
        );
        return {
          new_leads: recent.length,
          new_bookings: recentViewings.length,
          handoffs: recent.filter((l) => l.status === 'handoff').length,
          hot_leads: leads.filter((l) => l.potential_status === 'hot').length
        };
      }
    }),

    // ─── Subagent Triggers ──────────────────────────────────────────────────

    trigger_steward_briefing: tool({
      description:
        'Run the lead steward agent for a specific lead and return a full briefing. Use before advising on complex leads.',
      inputSchema: z.object({
        lead_id: z.string(),
        question: z.string().max(400).optional()
      }),
      execute: async ({ lead_id, question }) => {
        const lead = await getLeadById(lead_id);
        if (!lead) return { error: 'lead_not_found' };
        const stewardConv = await getOrCreateLeadSteward(lead_id);
        const prompt = question
          ? `${question} Please review this lead's full profile and give a concise briefing.`
          : `Please review this lead's full profile and conversation history. Give me a concise briefing: who they are, what they want, their qualification status, and recommended next action.`;
        const result = await runAgentTurn(stewardConv.id, prompt, {
          type: 'lead_steward',
          leadId: lead_id,
          adminId,
          adminName
        });
        return { ok: true, briefing: result.reply };
      }
    }),

    trigger_lead_turn: tool({
      description:
        'Inject a message into a lead conversation and run the lead agent. Use to have the bot send a specific response.',
      inputSchema: z.object({
        conversation_id: z.string(),
        message: z.string().min(1).max(1000)
      }),
      execute: async ({ conversation_id, message }) => {
        const result = await runAgentTurn(conversation_id, message, { type: 'lead' });
        return { ok: true, reply: result.reply };
      }
    }),

    // ─── System Config ──────────────────────────────────────────────────────

    update_criteria: tool({
      description: 'Replace agency qualification criteria. Takes effect on next lead turn.',
      inputSchema: z.object({ criteria: z.array(criterionSchema).min(1) }),
      execute: async ({ criteria }) => {
        ctx.config = await updateCriteria(criteria);
        return { ok: true, criteria: ctx.config.qualification_criteria };
      }
    }),

    update_config: tool({
      description: 'Adjust agency name and/or tone.',
      inputSchema: z.object({
        name: z.string().max(255).optional(),
        tone: z.string().max(1000).optional()
      }),
      execute: async ({ name, tone }) => {
        ctx.config = await upsertAgencyConfig({
          ...ctx.config,
          name: name ?? ctx.config.name,
          tone: tone ?? ctx.config.tone
        });
        return { ok: true, name: ctx.config.name };
      }
    }),

    notify_admin: tool({
      description: 'Send a Telegram notification to admins.',
      inputSchema: z.object({ summary: z.string().max(280) }),
      execute: async ({ summary }) => {
        await notifyAdmins(summary);
        return { ok: true };
      }
    })
  };
}
