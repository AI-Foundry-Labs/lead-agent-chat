import { tool } from 'ai';
import { z } from 'zod';
import { cancelViewingWithMemory, rescheduleViewingWithMemory } from '@/lib/agent/viewing-actions';
import {
  listBookedViewings,
  getViewingById,
  getListing,
  getLeadById,
  getConversationByLeadId,
  updateLead,
  findBookedSlot,
  createBookedViewing
} from '@/lib/db';
import { createCalendarEvent, getAvailableSlots, resolveSlotIso } from '@/lib/calendar';
import { syncLeadTopicTitles } from '@/lib/telegram/sync-lead-topic-titles';
import { scheduleAppendLeadLongTermFacts } from '@/lib/agent/append-lead-long-term-facts';
import { formatSlot } from '@/lib/format';
import type { AgentContext } from '@/lib/agent/tools/context';

export function buildViewingsTools(ctx: AgentContext) {
  return {
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

    get_viewing_detail: tool({
      description: 'Get full details for a single viewing by ID (slot, status, contact, calendar_event_id, listing, lead).',
      inputSchema: z.object({ viewing_id: z.string() }),
      execute: async ({ viewing_id }) => {
        const v = await getViewingById(viewing_id);
        if (!v || v.agency_id !== ctx.config.agency_id) return { error: 'viewing_not_found' };
        return {
          id: v.id,
          lead_id: v.lead_id,
          listing_id: v.listing_id,
          contact_email: v.contact_email,
          slot: v.confirmed_slot ? formatSlot(v.confirmed_slot.toISOString()) : null,
          status: v.status,
          calendar_event_id: v.calendar_event_id,
          summary: v.summary
        };
      }
    }),

    book_viewing: tool({
      description:
        'Book a viewing on behalf of a lead (admin-initiated). ' +
        'Use list_available_slots first to get valid slot_iso values. ' +
        'slot_iso MUST be the exact iso string from list_available_slots.',
      inputSchema: z.object({
        lead_id: z.string(),
        listing_id: z.string().optional().describe("Defaults to the lead's conversation listing"),
        slot_iso: z.string().describe('Exact iso from list_available_slots'),
        contact_email: z.string().email().optional().describe("Defaults to lead's email"),
        contact_name: z.string().optional()
      }),
      execute: async ({ lead_id, listing_id, slot_iso: rawSlotIso, contact_email, contact_name }) => {
        const lead = await getLeadById(lead_id);
        if (!lead) return { error: 'lead_not_found' };
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        const lid = listing_id ?? conv.listing_id;
        if (!lid) return { error: 'no_listing' };
        const listing = await getListing(lid);
        if (!listing) return { error: 'listing_not_found' };
        const email = contact_email ?? lead.email;
        if (!email) return { error: 'need_contact_email' };

        const slot_iso = resolveSlotIso(rawSlotIso);
        if (!slot_iso) return { error: 'invalid_slot' };

        const existing = await findBookedSlot(conv.id, slot_iso);
        if (existing) return { ok: true, already_booked: true, slot: formatSlot(slot_iso) };

        const eventId = await createCalendarEvent({
          calendarId: listing.agent_calendar_id || ctx.config.calendar_id,
          slotIso: slot_iso,
          contactEmail: email,
          contactName: contact_name ?? lead.name,
          listing
        });
        await createBookedViewing({
          agency_id: ctx.config.agency_id,
          conversation_id: conv.id,
          lead_id,
          listing_id: lid,
          contact_email: email,
          confirmed_slot: slot_iso,
          calendar_event_id: eventId,
          summary: `Viewing booked by admin for ${listing.title}`
        });
        await updateLead(lead_id, { email, name: contact_name ?? lead.name ?? undefined, status: 'booked' });
        if (contact_name && contact_name !== lead.name) {
          void syncLeadTopicTitles(ctx.config.agency_id, lead_id).catch((e) =>
            console.error('[main-assistant] syncLeadTopicTitles failed:', e)
          );
        }
        scheduleAppendLeadLongTermFacts(lead_id, [
          `viewing booked (by admin): ${listing.title} on ${formatSlot(slot_iso)}`,
          `contact: ${contact_name ?? lead.name ?? '—'} <${email}>`
        ]);
        return { ok: true, slot: formatSlot(slot_iso), listing: listing.title, address: listing.address };
      }
    }),

    cancel_viewing: tool({
      description: 'Cancel a booked viewing and delete the calendar event.',
      inputSchema: z.object({
        viewing_id: z.string(),
        reason: z.string().max(300).optional().describe('Reason for cancellation — stored in lead memory')
      }),
      execute: async ({ viewing_id, reason }) => {
        const v = await getViewingById(viewing_id);
        if (!v || v.agency_id !== ctx.config.agency_id) return { error: 'viewing_not_found' };
        return cancelViewingWithMemory(viewing_id, ctx.config.calendar_id, reason);
      }
    }),

    reschedule_viewing: tool({
      description: 'Reschedule a booked viewing to a new slot. Use list_available_slots first.',
      inputSchema: z.object({ viewing_id: z.string(), new_slot_iso: z.string() }),
      execute: async ({ viewing_id, new_slot_iso }) => {
        const v = await getViewingById(viewing_id);
        if (!v || v.agency_id !== ctx.config.agency_id) return { error: 'viewing_not_found' };
        return rescheduleViewingWithMemory(viewing_id, new_slot_iso, ctx.config.calendar_id);
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
    })
  };
}
