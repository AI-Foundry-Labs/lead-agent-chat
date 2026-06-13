/**
 * Shared viewing cancel/reschedule logic with automatic long-term memory updates.
 * Used by both main_assistant and operator agents to avoid duplication.
 */
import {
  getViewingById,
  getListing,
  cancelViewing,
  rescheduleViewing
} from '@/lib/db';
import { deleteCalendarEvent, createCalendarEvent } from '@/lib/calendar';
import { formatSlot } from '@/lib/format';
import { scheduleAppendLeadLongTermFacts } from '@/lib/agent/append-lead-long-term-facts';

/** Cancel a booked viewing, delete its calendar event, and record the event in lead memory. */
export async function cancelViewingWithMemory(
  viewingId: string,
  calendarFallbackId: string,
  reason?: string
): Promise<{ ok: true; cancelled: true } | { error: string }> {
  const v = await getViewingById(viewingId);
  if (!v) return { error: 'viewing_not_found' };

  const listing = v.listing_id ? await getListing(v.listing_id) : null;
  if (v.calendar_event_id) {
    const calendarId = listing?.agent_calendar_id || calendarFallbackId;
    await deleteCalendarEvent({ calendarId, eventId: v.calendar_event_id });
  }
  await cancelViewing(viewingId);

  if (v.lead_id) {
    const slotLabel = v.confirmed_slot ? formatSlot(v.confirmed_slot.toString()) : 'unknown slot';
    const listingLabel = listing?.title ?? v.listing_id ?? 'unknown listing';
    const date = new Date().toISOString().slice(0, 10);
    scheduleAppendLeadLongTermFacts(v.lead_id, [
      `PURCHASE STATUS — Viewing CANCELLED: ${listingLabel} at ${slotLabel}${reason ? ` — reason: ${reason}` : ''}`,
      `ADMIN ACTION — Admin cancelled viewing on ${date}${reason ? `: ${reason}` : ''}`
    ]);
  }
  return { ok: true, cancelled: true };
}

/** Reschedule a booked viewing to a new slot, sync calendar, and record it in lead memory. */
export async function rescheduleViewingWithMemory(
  viewingId: string,
  newSlotIso: string,
  calendarFallbackId: string
): Promise<{ ok: true; new_slot: string } | { error: string }> {
  const v = await getViewingById(viewingId);
  if (!v) return { error: 'viewing_not_found' };

  const listing = v.listing_id ? await getListing(v.listing_id) : null;
  const calendarId = listing?.agent_calendar_id || calendarFallbackId;
  if (v.calendar_event_id) {
    await deleteCalendarEvent({ calendarId, eventId: v.calendar_event_id });
  }
  let newCalendarEventId: string | null = null;
  if (listing && v.contact_email) {
    newCalendarEventId = await createCalendarEvent({
      calendarId,
      slotIso: newSlotIso,
      contactEmail: v.contact_email,
      listing
    });
  }
  await rescheduleViewing(viewingId, newSlotIso, newCalendarEventId);

  if (v.lead_id) {
    const listingLabel = listing?.title ?? v.listing_id ?? 'unknown listing';
    const oldSlot = v.confirmed_slot ? formatSlot(v.confirmed_slot.toString()) : 'unknown';
    scheduleAppendLeadLongTermFacts(v.lead_id, [
      `PURCHASE STATUS — Viewing RESCHEDULED: ${listingLabel} from ${oldSlot} to ${formatSlot(newSlotIso)}`
    ]);
  }
  return { ok: true, new_slot: formatSlot(newSlotIso) };
}
