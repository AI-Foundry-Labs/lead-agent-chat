import { and, eq, desc } from 'drizzle-orm';
import { db, scheduled_messages } from './client';

export type ScheduledMessage = typeof scheduled_messages.$inferSelect;

export async function createScheduledMessage(input: {
  agency_id: string;
  conversation_id: string;
  lead_id: string;
  content: string;
  send_at: Date;
  created_by?: string | null;
}): Promise<ScheduledMessage> {
  const [r] = await db.insert(scheduled_messages).values(input).returning();
  return r;
}

/** List scheduled messages for an agency (optionally one lead), newest first. */
export async function listScheduledMessages(
  agencyId: string,
  leadId?: string
): Promise<ScheduledMessage[]> {
  const where = leadId
    ? and(eq(scheduled_messages.agency_id, agencyId), eq(scheduled_messages.lead_id, leadId))
    : eq(scheduled_messages.agency_id, agencyId);
  return db
    .select()
    .from(scheduled_messages)
    .where(where)
    .orderBy(desc(scheduled_messages.send_at));
}

/** Cancel a still-pending scheduled message. Returns true if one was cancelled. */
export async function cancelScheduledMessage(
  agencyId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .update(scheduled_messages)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(scheduled_messages.id, id),
        eq(scheduled_messages.agency_id, agencyId),
        eq(scheduled_messages.status, 'pending')
      )
    )
    .returning({ id: scheduled_messages.id });
  return rows.length > 0;
}
