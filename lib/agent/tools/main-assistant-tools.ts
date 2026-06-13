import { tool } from 'ai';
import { z } from 'zod';
import { ilike, or, eq } from 'drizzle-orm';
import { scheduleAppendLeadLongTermFacts } from '@/lib/agent/append-lead-long-term-facts';
import { cancelViewingWithMemory, rescheduleViewingWithMemory } from '@/lib/agent/viewing-actions';
import {
  listLeads,
  getLeadById,
  getConversationByLeadId,
  getVisibleMessages,
  addMessage,
  updateConversation,
  updateLead,
  updateCriteria,
  upsertAgencyConfig,
  listListings,
  getListing,
  createListing,
  updateListing,
  listBookedViewings,
  getOrCreateLeadOperator,
  listConversationsByLeadId,
  listHandoffRules,
  createHandoffRule,
  toggleHandoffRule,
  deleteHandoffRule,
  db,
  messages,
  leads,
  conversations
} from '@/lib/db';
import { sendTelegramMessage } from '@/lib/telegram';
import { getAvailableSlots } from '@/lib/calendar';
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
  actor: { type: 'operator'; leadId: string | null; adminId: string; adminName: string | null } | { type: 'lead' },
  lang?: string,
  messageRole?: 'user' | 'system'
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
        let leads = await listLeads(ctx.config.agency_id);
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

    search_leads: tool({
      description: 'Search leads by name or email (partial match, case-insensitive).',
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }) => {
        const q = `%${query}%`;
        const rows = await db
          .select({
            id: leads.id,
            email: leads.email,
            name: leads.name,
            status: leads.status,
            potential_status: leads.potential_status,
            score_reason: leads.score_reason,
            updated_at: leads.updated_at
          })
          .from(leads)
          .where(or(ilike(leads.email, q), ilike(leads.name, q)))
          .limit(20);
        return rows;
      }
    }),

    search_messages: tool({
      description: 'Search for a keyword across all conversation messages. Returns matching messages with lead/conversation context.',
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(30).optional()
      }),
      execute: async ({ query, limit }) => {
        const q = `%${query}%`;
        const rows = await db
          .select({
            message_id: messages.id,
            conversation_id: messages.conversation_id,
            role: messages.role,
            content: messages.content,
            timestamp: messages.timestamp,
            lead_id: conversations.lead_id
          })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversation_id, conversations.id))
          .where(ilike(messages.content, q))
          .orderBy(messages.timestamp)
          .limit(limit ?? 15);
        return rows.map((r) => ({
          conversation_id: r.conversation_id,
          lead_id: r.lead_id,
          role: r.role,
          excerpt: r.content.slice(0, 300),
          timestamp: r.timestamp
        }));
      }
    }),

    get_lead_threads: tool({
      description: 'List all conversation threads for a lead (web, Telegram, operator, etc.).',
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const threads = await listConversationsByLeadId(lead_id);
        return threads.map((t) => ({
          conversation_id: t.id,
          type: t.type,
          channel: t.primary_channel,
          mode: t.mode,
          listing_id: t.listing_id,
          thread_summary: t.thread_summary?.slice(0, 200),
          updated_at: t.updated_at
        }));
      }
    }),

    update_lead_info: tool({
      description:
        'Update a lead\'s profile fields and/or system status. ' +
        'Use proactively when you learn significant facts: lead says they won\'t buy → status=abandoned; ' +
        'lead confirms purchase → status=qualified or booked; lead needs human → status=handoff. ' +
        'Always pass memory_note when changing status so the reason is persisted.',
      inputSchema: z.object({
        lead_id: z.string(),
        name: z.string().max(255).optional(),
        email: z.string().email().optional(),
        status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned'])
          .optional()
          .describe('New lifecycle status — set abandoned when lead confirms they will not purchase'),
        potential_status: z.enum(['hot', 'warm', 'cold'])
          .optional()
          .describe('New potential tier — update when intent clearly changes (e.g. cold after abandonment)'),
        memory_note: z.string().max(600)
          .optional()
          .describe('Reason for the change — stored in lead long-term memory (e.g. "lead said they found another property and are no longer interested")')
      }),
      execute: async ({ lead_id, name, email, status, potential_status, memory_note }) => {
        const lead = await getLeadById(lead_id);
        if (!lead) return { error: 'lead_not_found' };
        const updated = await updateLead(lead_id, {
          ...(name !== undefined && { name }),
          ...(email !== undefined && { email }),
          ...(status !== undefined && { status }),
          ...(potential_status !== undefined && { potential_status })
        });
        // Persist reason to long-term memory when status/potential changes
        if (memory_note) {
          const date = new Date().toISOString().slice(0, 10);
          const statusNote = status ? `status→${status}` : '';
          const potentialNote = potential_status ? ` potential→${potential_status}` : '';
          scheduleAppendLeadLongTermFacts(lead_id, [
            `PURCHASE STATUS — ${date}: ${statusNote}${potentialNote}. ${memory_note}`
          ]);
        }
        return {
          ok: true,
          id: updated.id,
          name: updated.name,
          email: updated.email,
          status: updated.status,
          potential_status: updated.potential_status
        };
      }
    }),

    get_lead_viewings: tool({
      description: 'List all viewings for a specific lead.',
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const all = await listBookedViewings(ctx.config.agency_id);
        const filtered = all.filter((v) => v.lead_id === lead_id);
        return filtered.map((v) => ({
          id: v.id,
          listing_id: v.listing_id,
          contact_email: v.contact_email,
          slot: v.confirmed_slot ? formatSlot(v.confirmed_slot.toString()) : null,
          status: v.status,
          calendar_event_id: v.calendar_event_id
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
      description:
        'Directly send a message FROM the admin TO a lead on their active channel. ' +
        'Use this whenever admin wants to write a specific message to a lead — it is saved as an admin message and dispatched immediately. ' +
        'Use memory_note to record significant events (e.g. "viewing cancelled — listing no longer available, apology sent") into the lead long-term memory. ' +
        'Do NOT use trigger_lead_turn for this purpose.',
      inputSchema: z.object({
        lead_id: z.string(),
        content: z.string().min(1),
        memory_note: z.string().max(600).optional().describe(
          'Optional: a brief note about WHY this message was sent — stored in lead long-term memory. Use for significant events (cancellations, offers, follow-ups).'
        )
      }),
      execute: async ({ lead_id, content, memory_note }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await addMessage({ conversation_id: conv.id, role: 'admin', content });
        await dispatchReply(conv, content);
        broadcastConversationUpdate(conv.id);
        // Persist significant admin contact to lead long-term memory
        if (memory_note) {
          const date = new Date().toISOString().slice(0, 10);
          scheduleAppendLeadLongTermFacts(lead_id, [
            `ADMIN ACTION — ${date}: ${memory_note}`
          ]);
        }
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
        const listings = await listListings(ctx.config.agency_id);
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
      // agency_id is injected server-side from ctx; exclude from agent input schema
      inputSchema: listingSchema.omit({ agency_id: true }),
      execute: async (input) => {
        // Normalize image_url: zod schema allows undefined, but Listing type requires null
        const listing = await createListing({
          ...input,
          agency_id: ctx.config.agency_id,
          image_url: input.image_url ?? null
        });
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
        const viewings = await listBookedViewings(ctx.config.agency_id);
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
      inputSchema: z.object({
        viewing_id: z.string(),
        reason: z.string().max(300).optional().describe('Reason for cancellation — stored in lead memory')
      }),
      execute: async ({ viewing_id, reason }) =>
        cancelViewingWithMemory(viewing_id, ctx.config.calendar_id, reason)
    }),

    reschedule_viewing: tool({
      description: 'Reschedule a booked viewing to a new slot. Use list_available_slots first.',
      inputSchema: z.object({ viewing_id: z.string(), new_slot_iso: z.string() }),
      execute: async ({ viewing_id, new_slot_iso }) =>
        rescheduleViewingWithMemory(viewing_id, new_slot_iso, ctx.config.calendar_id)
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
        const leads = await listLeads(ctx.config.agency_id);
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
        const leads = await listLeads(ctx.config.agency_id);
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recent = leads.filter((l) => l.created_at && new Date(l.created_at) >= cutoff);
        const viewings = await listBookedViewings(ctx.config.agency_id);
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

    trigger_operator_briefing: tool({
      description:
        'Run the lead operator agent for a specific lead and return a full briefing. Use before advising on complex leads.',
      inputSchema: z.object({
        lead_id: z.string(),
        question: z.string().max(400).optional()
      }),
      execute: async ({ lead_id, question }) => {
        const lead = await getLeadById(lead_id);
        if (!lead) return { error: 'lead_not_found' };
        const operatorConv = await getOrCreateLeadOperator(lead_id, ctx.config.agency_id);
        const prompt = question
          ? `${question} Please review this lead's full profile and give a concise briefing.`
          : `Please review this lead's full profile and conversation history. Give me a concise briefing: who they are, what they want, their qualification status, and recommended next action.`;
        const result = await runAgentTurn(operatorConv.id, prompt, {
          type: 'operator',
          leadId: lead_id,
          adminId,
          adminName
        });
        return { ok: true, briefing: result.reply };
      }
    }),

    trigger_lead_turn: tool({
      description:
        'Make the lead AI agent autonomously generate and send a response in a conversation. ' +
        'The injected message is an INTERNAL instruction to the bot — it is NOT sent to the lead and does NOT appear as a user message. ' +
        'Use ONLY when you want the bot to decide what to say on its own (e.g. re-engage, follow up). ' +
        'To send a specific message you wrote yourself, use send_reply instead.',
      inputSchema: z.object({
        conversation_id: z.string(),
        message: z.string().min(1).max(1000).describe('Internal instruction for the lead agent — not visible to the lead')
      }),
      execute: async ({ conversation_id, message }) => {
        // Detect conversation language from recent user messages so the lead agent
        // uses the correct defaultLang (not always 'fr').
        const recentMsgs = await getVisibleMessages(conversation_id);
        const lastUserMsg = [...recentMsgs].reverse().find((m) => m.role === 'user');
        const detectedLang = lastUserMsg && /[a-zA-Z]/.test(lastUserMsg.content)
          && !/[àâçéèêëîïôùûüÿœæ]/i.test(lastUserMsg.content)
          ? 'en' : 'fr';
        // messageRole 'system' keeps the injected instruction out of the lead's visible chat
        const result = await runAgentTurn(conversation_id, message, { type: 'lead' }, detectedLang, 'system');
        return { ok: true, reply: result.reply };
      }
    }),

    // ─── Bulk Follow-up ────────────────────────────────────────────────────

    bulk_follow_up: tool({
      description:
        'Send a follow-up message to all hot/warm leads whose last conversation activity exceeds a given number of days. Returns list of leads messaged.',
      inputSchema: z.object({
        message: z.string().min(1).max(1000).describe('Message to send to each lead'),
        potential: z.enum(['hot', 'warm']).optional().describe('Filter by potential — omit for both'),
        inactive_days: z.number().int().min(1).max(90).default(7).describe('Minimum days since last activity')
      }),
      execute: async ({ message, potential, inactive_days }) => {
        const cutoff = new Date(Date.now() - inactive_days * 24 * 60 * 60 * 1000);
        let allLeads = await listLeads(ctx.config.agency_id);
        if (potential) allLeads = allLeads.filter((l) => l.potential_status === potential);
        else allLeads = allLeads.filter((l) => l.potential_status === 'hot' || l.potential_status === 'warm');
        // Only active/qualified leads (not already booked/abandoned)
        allLeads = allLeads.filter((l) => l.status === 'active' || l.status === 'qualified');

        const results: { lead_id: string; email: string | null; name: string | null; sent: boolean; reason?: string }[] = [];
        for (const lead of allLeads) {
          const conv = await getConversationByLeadId(lead.id);
          if (!conv) { results.push({ lead_id: lead.id, email: lead.email, name: lead.name, sent: false, reason: 'no_conversation' }); continue; }
          const lastActivity = conv.updated_at ? new Date(conv.updated_at) : null;
          if (lastActivity && lastActivity >= cutoff) { results.push({ lead_id: lead.id, email: lead.email, name: lead.name, sent: false, reason: 'recently_active' }); continue; }
          await addMessage({ conversation_id: conv.id, role: 'admin', content: message });
          await dispatchReply(conv, message);
          broadcastConversationUpdate(conv.id);
          results.push({ lead_id: lead.id, email: lead.email, name: lead.name, sent: true });
        }
        const sent = results.filter((r) => r.sent).length;
        return { total_contacted: sent, skipped: results.length - sent, details: results };
      }
    }),

    // ─── Listing Performance ────────────────────────────────────────────────

    listing_performance: tool({
      description:
        'Report on each listing: number of leads, qualification rate, bookings, and estimated pipeline value.',
      inputSchema: z.object({}),
      execute: async () => {
        const [allLeads, allViewings, allListings] = await Promise.all([
          listLeads(ctx.config.agency_id),
          listBookedViewings(ctx.config.agency_id),
          listListings(ctx.config.agency_id)
        ]);
        return allListings.map((listing) => {
          const listingLeads = allLeads.filter((l) => l.listing_id === listing.id);
          const bookings = allViewings.filter((v) => v.listing_id === listing.id && v.status !== 'cancelled');
          const hot = listingLeads.filter((l) => l.potential_status === 'hot').length;
          const warm = listingLeads.filter((l) => l.potential_status === 'warm').length;
          const qualified = listingLeads.filter((l) => l.status === 'qualified' || l.status === 'booked').length;
          const conversionRate = listingLeads.length > 0
            ? `${Math.round((bookings.length / listingLeads.length) * 100)}%`
            : '—';
          return {
            listing_id: listing.id,
            title: listing.title,
            price: formatPrice(listing.price),
            total_leads: listingLeads.length,
            hot,
            warm,
            qualified,
            viewings_booked: bookings.length,
            conversion_rate: conversionRate
          };
        });
      }
    }),

    // ─── Handoff Rules Management ───────────────────────────────────────────

    list_handoff_rules: tool({
      description: 'List all handoff/escalation rules (active and inactive).',
      inputSchema: z.object({}),
      execute: async () => {
        const rules = await listHandoffRules(ctx.config.agency_id);
        return rules.map((r) => ({
          id: r.id,
          description: r.description,
          trigger_keywords: r.trigger_keywords,
          active: r.active
        }));
      }
    }),

    create_handoff_rule: tool({
      description: 'Create a new handoff rule. When a lead message matches any keyword, admins are alerted.',
      inputSchema: z.object({
        description: z.string().min(1).max(255).describe('Human-readable description of when this rule fires'),
        trigger_keywords: z.array(z.string().min(1)).min(1).describe('Keywords that trigger this rule')
      }),
      execute: async ({ description, trigger_keywords }) => {
        const rule = await createHandoffRule({ agency_id: ctx.config.agency_id, description, trigger_keywords });
        return { ok: true, id: rule.id, description: rule.description, active: rule.active };
      }
    }),

    toggle_handoff_rule: tool({
      description: 'Activate or deactivate a handoff rule by ID.',
      inputSchema: z.object({
        rule_id: z.string(),
        active: z.boolean()
      }),
      execute: async ({ rule_id, active }) => {
        const rule = await toggleHandoffRule(rule_id, active);
        return { ok: true, id: rule.id, description: rule.description, active: rule.active };
      }
    }),

    delete_handoff_rule: tool({
      description: 'Permanently delete a handoff rule.',
      inputSchema: z.object({ rule_id: z.string() }),
      execute: async ({ rule_id }) => {
        await deleteHandoffRule(rule_id);
        return { ok: true, deleted: rule_id };
      }
    }),

    // ─── Telegram Broadcast ─────────────────────────────────────────────────

    telegram_broadcast: tool({
      description:
        'Send a message to all leads who have Telegram linked. Optionally filter by potential status or listing.',
      inputSchema: z.object({
        message: z.string().min(1).max(1000),
        potential: z.enum(['hot', 'warm', 'cold']).optional(),
        listing_id: z.string().optional()
      }),
      execute: async ({ message, potential, listing_id }) => {
        let allLeads = await listLeads(ctx.config.agency_id);
        allLeads = allLeads.filter((l) => !!l.telegram_user_id);
        if (potential) allLeads = allLeads.filter((l) => l.potential_status === potential);
        if (listing_id) allLeads = allLeads.filter((l) => l.listing_id === listing_id);

        const results: { lead_id: string; name: string | null; sent: boolean }[] = [];
        for (const lead of allLeads) {
          try {
            await sendTelegramMessage(lead.telegram_user_id!, message);
            results.push({ lead_id: lead.id, name: lead.name, sent: true });
          } catch {
            results.push({ lead_id: lead.id, name: lead.name, sent: false });
          }
        }
        const sent = results.filter((r) => r.sent).length;
        return { total_sent: sent, failed: results.length - sent, details: results };
      }
    }),

    // ─── System Config ──────────────────────────────────────────────────────

    update_criteria: tool({
      description: 'Replace agency qualification criteria. Takes effect on next lead turn.',
      inputSchema: z.object({ criteria: z.array(criterionSchema).min(1) }),
      execute: async ({ criteria }) => {
        ctx.config = await updateCriteria(ctx.config.agency_id, criteria);
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
