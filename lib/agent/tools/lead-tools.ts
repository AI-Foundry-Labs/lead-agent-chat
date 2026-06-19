import { tool } from 'ai';
import { z } from 'zod';
import {
  getListing,
  listListings,
  updateLead,
  updateConversation,
  findBookedSlot,
  createBookedViewing,
  listViewingsByConversation,
  getViewingById
} from '@/lib/db';
import { getAvailableSlots, createCalendarEvent, resolveSlotIso } from '@/lib/calendar';
import { notifyAdmins } from '@/lib/notify';
import { formatPrice, formatSlot } from '@/lib/format';
import { scheduleAppendLeadLongTermFacts } from '@/lib/agent/append-lead-long-term-facts';
import { formatConversationForMemory } from '@/lib/agent/cross-thread-context';
import { issueLeadTelegramLinkToken } from '@/lib/auth';
import { buildLeadTelegramLinkInfo } from '@/lib/telegram/build-lead-telegram-link';
import { telegramConfigured } from '@/lib/telegram';
import { cancelViewingWithMemory, rescheduleViewingWithMemory } from '@/lib/agent/viewing-actions';
import { syncLeadStatusToTelegram } from '@/lib/telegram/lead-status-marker';
import { syncLeadTopicTitles } from '@/lib/telegram/sync-lead-topic-titles';
import { pushAgentNotification } from '@/lib/agent/push-agent-notification';
import type { AgentContext } from './context';
import { ensureLead } from './context';

function qualFactsFromValues(
  values: Record<string, string>,
  criteria: { key: string; label: string }[]
): string[] {
  return Object.entries(values).map(([key, value]) => {
    const label = criteria.find((c) => c.key === key)?.label ?? key;
    return `${label}: ${value}`;
  });
}

export function buildLeadTools(ctx: AgentContext) {
  const listingId = ctx.conversation.listing_id;

  return {
    get_listing: tool({
      description:
        'Get full details of a property. Defaults to the one under discussion.',
      inputSchema: z.object({
        listing_id: z.string().optional()
      }),
      execute: async ({ listing_id }) => {
        const listing = await getListing(listing_id ?? listingId);
        if (!listing) return { error: 'listing_not_found' };
        return listing;
      }
    }),

    search_listings: tool({
      description:
        'Find other properties matching rough criteria (price ceiling, min rooms, free-text).',
      inputSchema: z.object({
        max_price: z.number().int().positive().optional(),
        min_rooms: z.number().int().positive().optional(),
        query: z.string().optional()
      }),
      execute: async ({ max_price, min_rooms, query }) => {
        const all = await listListings(ctx.config.agency_id);
        const q = query?.toLowerCase();
        const matches = all.filter((l) => {
          if (max_price && l.price > max_price) return false;
          if (min_rooms && l.rooms < min_rooms) return false;
          if (q && !`${l.title} ${l.address} ${l.description}`.toLowerCase().includes(q))
            return false;
          return true;
        });
        return matches.map((l) => ({
          id: l.id,
          title: l.title,
          address: l.address,
          price: formatPrice(l.price),
          rooms: l.rooms,
          surface_m2: l.surface_m2
        }));
      }
    }),

    record_qualification: tool({
      description:
        'Persist extracted qualification values, a computed potential status, and a one-line reason. Call whenever you learn new info.',
      inputSchema: z.object({
        values: z
          .record(z.string(), z.string())
          .describe('criterionKey → value, e.g. { budget: "800k€" }'),
        potential_status: z.enum(['hot', 'warm', 'cold']),
        reason: z.string().max(200)
      }),
      execute: async ({ values, potential_status, reason }) => {
        const lead = await ensureLead(ctx);
        const prevPotential = lead.potential_status;
        const merged = { ...lead.qual_values, ...values };
        const allKeys = ctx.config.qualification_criteria.map((c) => c.key);
        const complete = allKeys.every((k) => merged[k]);
        const updated = await updateLead(lead.id, {
          qual_values: merged,
          potential_status,
          score_reason: reason,
          // Only promote to 'qualified' from 'active' — never downgrade booked/handoff/abandoned.
          status: complete && lead.status === 'active' ? 'qualified' : lead.status
        });

        // Surface a hot/warm/cold change in the agency's Telegram topic (off-path, guarded).
        void syncLeadStatusToTelegram(
          ctx.config.agency_id, lead.id, prevPotential, potential_status, reason
        ).catch((e) => console.error('[lead-tools] syncLeadStatusToTelegram failed:', e));
        scheduleAppendLeadLongTermFacts(
          lead.id,
          [
            ...qualFactsFromValues(values, ctx.config.qualification_criteria),
            `potential: ${potential_status}`
          ],
          reason
        );
        return {
          ok: true,
          qual_values: updated.qual_values,
          potential_status,
          all_criteria_collected: complete
        };
      }
    }),

    get_available_slots: tool({
      description:
        'List candidate viewing slots for the property. ' +
        'Returns each slot as { iso, label } where iso is an opaque token to pass back to book_viewing. ' +
        'ALWAYS copy the exact iso string from this response — never modify it, never construct your own timestamp from the label.',
      inputSchema: z.object({ count: z.number().int().min(1).max(5).optional() }),
      execute: async ({ count }) => {
        const listing = await getListing(listingId);
        if (!listing) return { error: 'no_listing_selected' };
        const slots = await getAvailableSlots({
          calendarId: listing.agent_calendar_id || ctx.config.calendar_id,
          preferredTimeline: null,
          count: count ?? 3
        });
        return {
          slots: slots.map((iso) => ({ iso, label: formatSlot(iso) }))
        };
      }
    }),

    book_viewing: tool({
      description:
        'Book a viewing. slot_iso MUST be the exact iso string returned by get_available_slots — ' +
        'never construct a timestamp from a label or user-stated time. ' +
        'Requires a contact email — if missing, ask the visitor for it first. ' +
        'already_booked:true in the response means the booking is already confirmed — do NOT try another slot.',
      inputSchema: z.object({
        slot_iso: z.string(),
        contact_email: z.string().email().optional(),
        contact_name: z.string().optional()
      }),
      execute: async ({ slot_iso: rawSlotIso, contact_email, contact_name }) => {
        const listing = await getListing(listingId);
        if (!listing) return { error: 'no_listing_selected' };

        // The model often corrupts the offered ISO (drops the Paris offset → +2h,
        // and/or hallucinates the year). Snap it back to the real candidate slot
        // by Paris wall-clock before doing anything with it.
        const slot_iso = resolveSlotIso(rawSlotIso);
        if (!slot_iso) return { error: 'invalid_slot' };

        const lead = await ensureLead(ctx);
        const email = contact_email ?? lead.email ?? undefined;
        if (!email) return { need_contact: true };

        // Idempotency: don't double-book the same slot for this conversation.
        const existing = await findBookedSlot(ctx.conversation.id, slot_iso);
        if (existing) {
          return { ok: true, already_booked: true, slot: formatSlot(slot_iso) };
        }

        const details = ctx.config.qualification_criteria
          .map((c) => `${c.label}: ${lead.qual_values[c.key] ?? '—'}`)
          .join('\n');
        const eventId = await createCalendarEvent({
          calendarId: listing.agent_calendar_id || ctx.config.calendar_id,
          slotIso: slot_iso,
          contactEmail: email,
          contactName: contact_name ?? lead.name,
          listing,
          details: `Potential: ${lead.potential_status ?? '—'}\n${details}`
        });
        await createBookedViewing({
          agency_id: ctx.config.agency_id,
          conversation_id: ctx.conversation.id,
          lead_id: lead.id,
          listing_id: listing.id,
          contact_email: email,
          confirmed_slot: slot_iso,
          calendar_event_id: eventId,
          summary: `Viewing booked for ${listing.title}`
        });
        await updateLead(lead.id, {
          email,
          name: contact_name ?? lead.name,
          status: 'booked'
        });
        // A real name may now be known — re-sync both topic titles (off-path, guarded).
        if (contact_name && contact_name !== lead.name) {
          void syncLeadTopicTitles(ctx.config.agency_id, lead.id).catch((e) =>
            console.error('[lead-tools] syncLeadTopicTitles failed:', e)
          );
        }
        const contact = contact_name ?? lead.name ?? email;
        void pushAgentNotification({
          agencyId: ctx.config.agency_id,
          leadId: lead.id,
          event: { kind: 'viewing_booked', title: listing.title, slot: formatSlot(slot_iso), contact },
          lang: ctx.lang
        });
        scheduleAppendLeadLongTermFacts(lead.id, [
          `viewing booked: ${listing.title} (${listing.address}) on ${formatSlot(slot_iso)}`,
          `contact: ${contact_name ?? lead.name ?? '—'} <${email}>`,
          `listing price: ${formatPrice(listing.price)}`
        ]);
        return {
          ok: true,
          slot: formatSlot(slot_iso),
          agent: listing.agent_name,
          address: listing.address
        };
      }
    }),

    request_handoff: tool({
      description:
        'Flag this conversation for human follow-up (e.g. negotiation, sensitive topic). Stops auto-replies until an agent releases it.',
      inputSchema: z.object({ reason: z.string().max(200) }),
      execute: async ({ reason }) => {
        ctx.conversation = await updateConversation(ctx.conversation.id, {
          mode: 'manual'
        });
        if (ctx.conversation.lead_id) {
          await updateLead(ctx.conversation.lead_id, { status: 'handoff' });
          void pushAgentNotification({
            agencyId: ctx.config.agency_id,
            leadId: ctx.conversation.lead_id,
            event: { kind: 'handoff_requested', reason },
            lang: ctx.lang
          });
        }
        return { ok: true, handed_off: true };
      }
    }),

    update_lead_status: tool({
      description:
        'Update this visitor\'s potential (hot/warm/cold) and/or lifecycle status as their intent becomes clear. ' +
        'Use status=abandoned when they say they are no longer interested / will not buy; ' +
        'status=qualified once criteria are gathered; status=handoff for sensitive topics. ' +
        'Always pass memory_note explaining why — it is persisted to long-term memory.',
      inputSchema: z.object({
        potential_status: z.enum(['hot', 'warm', 'cold']).optional(),
        status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
        memory_note: z.string().max(400).describe('Why the status changed — e.g. "said they found another property"')
      }),
      execute: async ({ potential_status, status, memory_note }) => {
        const lead = await ensureLead(ctx);
        const prevPotential = lead.potential_status;
        const updated = await updateLead(lead.id, {
          ...(potential_status !== undefined && { potential_status }),
          ...(status !== undefined && { status })
        });

        // Surface a hot/warm/cold change in the agency's Telegram topic (off-path, guarded).
        if (potential_status !== undefined) {
          void syncLeadStatusToTelegram(
            ctx.config.agency_id, lead.id, prevPotential, potential_status, memory_note
          ).catch((e) => console.error('[lead-tools] syncLeadStatusToTelegram failed:', e));
        }

        const date = new Date().toISOString().slice(0, 10);
        const parts = [
          status ? `status→${status}` : '',
          potential_status ? `potential→${potential_status}` : ''
        ].filter(Boolean).join(' ');
        scheduleAppendLeadLongTermFacts(lead.id, [`PURCHASE STATUS — ${date}: ${parts}. ${memory_note}`.trim()]);
        return { ok: true, status: updated.status, potential_status: updated.potential_status };
      }
    }),

    remember_visitor_fact: tool({
      description:
        'Persist durable visitor facts for future chats: identity/contact, product preferences, purchase status updates (viewing booked/cancelled/attended), objections, admin actions. Be thorough — storage is generous.',
      inputSchema: z.object({
        facts: z
          .array(z.string().max(800))
          .min(1)
          .max(20)
          .describe('Factual bullets, e.g. "Budget: 750k€", "Viewing cancelled: Montmartre 10 juin — listing no longer available", "Prefers Marais"')
      }),
      execute: async ({ facts }) => {
        const lead = await ensureLead(ctx);
        const tag = formatConversationForMemory(ctx.conversation);
        const tagged = facts.map((f) =>
          f.includes('[') ? f : `[${tag}] ${f}`
        );
        scheduleAppendLeadLongTermFacts(lead.id, tagged, undefined, tag);
        return { ok: true, stored: tagged.length };
      }
    }),

    suggest_telegram_chat: tool({
      description:
        'Generate a Telegram deep link so the visitor can continue on mobile in a separate Telegram thread (shared profile, fresh chat history). Web/email only.',
      inputSchema: z.object({}),
      execute: async () => {
        if (ctx.conversation.primary_channel === 'telegram') {
          return { error: 'already_on_telegram' };
        }
        if (!telegramConfigured()) {
          return { error: 'telegram_not_configured' };
        }
        const token = await issueLeadTelegramLinkToken({
          conversationId: ctx.conversation.id,
          leadId: ctx.conversation.lead_id,
          listingId: ctx.conversation.listing_id
        });
        const link = await buildLeadTelegramLinkInfo(token);
        return {
          ok: true,
          deep_link: link.deepLink,
          command: link.command,
          hint:
            'Share the deep_link as a clickable URL, or give them the /start command to paste in Telegram if the link fails.'
        };
      }
    }),

    notify_admin: tool({
      description: 'Send a short notification to the agency admins.',
      inputSchema: z.object({ summary: z.string().max(280) }),
      execute: async ({ summary }) => {
        await notifyAdmins(summary);
        return { ok: true };
      }
    }),

    // ─── Viewing Management ─────────────────────────────────────────────────

    get_lead_viewings: tool({
      description: 'List all viewings booked in this conversation. Use when the visitor asks about their scheduled appointment.',
      inputSchema: z.object({}),
      execute: async () => {
        const viewings = await listViewingsByConversation(ctx.conversation.id);
        return viewings.map((v) => ({
          id: v.id,
          listing_id: v.listing_id,
          slot: v.confirmed_slot ? formatSlot(v.confirmed_slot.toISOString()) : null,
          status: v.status,
          contact_email: v.contact_email
        }));
      }
    }),

    cancel_viewing: tool({
      description: 'Cancel a viewing booked in this conversation. Use only when the visitor explicitly requests cancellation.',
      inputSchema: z.object({
        viewing_id: z.string(),
        reason: z.string().max(300).optional().describe('Reason for cancellation — stored in memory')
      }),
      execute: async ({ viewing_id, reason }) => {
        // Ownership guard: only allow cancelling viewings from this conversation
        const viewing = await getViewingById(viewing_id);
        if (!viewing || viewing.conversation_id !== ctx.conversation.id) {
          return { error: 'viewing_not_found' };
        }
        return cancelViewingWithMemory(viewing_id, ctx.config.calendar_id, reason);
      }
    }),

    reschedule_viewing: tool({
      description:
        'Reschedule a viewing to a new slot. Call get_available_slots first to get valid iso values. ' +
        'new_slot_iso MUST be the exact iso string from get_available_slots — never construct a timestamp manually.',
      inputSchema: z.object({
        viewing_id: z.string(),
        new_slot_iso: z.string().describe('Exact iso from get_available_slots')
      }),
      execute: async ({ viewing_id, new_slot_iso }) => {
        // Ownership guard: only allow rescheduling viewings from this conversation
        const viewing = await getViewingById(viewing_id);
        if (!viewing || viewing.conversation_id !== ctx.conversation.id) {
          return { error: 'viewing_not_found' };
        }
        return rescheduleViewingWithMemory(viewing_id, new_slot_iso, ctx.config.calendar_id);
      }
    }),

    update_lead_persona: tool({
      description:
        'Update or replace the lead\'s freeform persona text. Call after gathering enough context to write a concise profile summary (1–5 sentences). Captures identity, stated intent, preferences, key objections, and behavioral notes. This is the curated admin view of the lead — write it as a professional agent briefing note.',
      inputSchema: z.object({
        persona: z.string().max(2000).describe('Freeform profile summary, 1–5 sentences')
      }),
      execute: async ({ persona }) => {
        const lead = await ensureLead(ctx);
        await updateLead(lead.id, { persona });
        return { ok: true };
      }
    })
  };
}
