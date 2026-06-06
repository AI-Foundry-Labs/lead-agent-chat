import { and, desc, eq } from 'drizzle-orm';
import { db, viewing_slots } from './client';
import type { ViewingSlot, ViewingStatus } from '@/lib/types';

function rowToViewing(r: typeof viewing_slots.$inferSelect): ViewingSlot {
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    lead_id: r.lead_id,
    listing_id: r.listing_id,
    contact_email: r.contact_email,
    proposed_slots: r.proposed_slots ?? [],
    confirmed_slot: r.confirmed_slot,
    status: r.status as ViewingStatus,
    calendar_event_id: r.calendar_event_id,
    summary: r.summary,
    created_at: r.created_at
  };
}

export async function getActiveViewing(
  conversationId: string
): Promise<ViewingSlot | null> {
  const rows = await db
    .select()
    .from(viewing_slots)
    .where(eq(viewing_slots.conversation_id, conversationId))
    .orderBy(desc(viewing_slots.created_at))
    .limit(1);
  return rows[0] ? rowToViewing(rows[0]) : null;
}

// Idempotency: a conversation should not double-book the same slot.
export async function findBookedSlot(
  conversationId: string,
  slotIso: string
): Promise<ViewingSlot | null> {
  const rows = await db
    .select()
    .from(viewing_slots)
    .where(
      and(
        eq(viewing_slots.conversation_id, conversationId),
        eq(viewing_slots.confirmed_slot, new Date(slotIso)),
        eq(viewing_slots.status, 'booked')
      )
    )
    .limit(1);
  return rows[0] ? rowToViewing(rows[0]) : null;
}

export async function createBookedViewing(input: {
  conversation_id: string;
  lead_id?: string | null;
  listing_id: string;
  contact_email: string;
  confirmed_slot: string;
  calendar_event_id: string;
  summary?: string | null;
}): Promise<ViewingSlot> {
  const [r] = await db
    .insert(viewing_slots)
    .values({
      conversation_id: input.conversation_id,
      lead_id: input.lead_id ?? null,
      listing_id: input.listing_id,
      contact_email: input.contact_email,
      confirmed_slot: new Date(input.confirmed_slot),
      status: 'booked',
      calendar_event_id: input.calendar_event_id,
      summary: input.summary ?? null
    })
    .returning();
  return rowToViewing(r);
}

export async function listBookedViewings(): Promise<ViewingSlot[]> {
  const rows = await db
    .select()
    .from(viewing_slots)
    .where(eq(viewing_slots.status, 'booked'))
    .orderBy(desc(viewing_slots.created_at));
  return rows.map(rowToViewing);
}
