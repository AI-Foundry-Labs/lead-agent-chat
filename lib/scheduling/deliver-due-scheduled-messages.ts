/**
 * Claim-and-deliver due scheduled messages (F4a). Called on an interval by the
 * scheduled-message loop. Concurrency-safe via `FOR UPDATE SKIP LOCKED`:
 * each due row is locked in its own transaction while delivered, so multiple
 * app instances never deliver the same row twice. At-least-once semantics — a
 * crash mid-send may re-deliver (the message lands in the thread either way).
 */
import { and, eq, lte, asc } from 'drizzle-orm';
import { db, scheduled_messages } from '@/lib/db/client';
import { getConversation } from '@/lib/db/conversations';
import { addMessage } from '@/lib/db/messages';
import { recordAudit } from '@/lib/db/audit-helpers';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';

const MAX_PER_TICK = 50;
const MAX_ATTEMPTS = 3;

// Deliver a single due row inside its own transaction; returns false when none left.
async function deliverOne(now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(scheduled_messages)
      .where(and(eq(scheduled_messages.status, 'pending'), lte(scheduled_messages.send_at, now)))
      .orderBy(asc(scheduled_messages.send_at))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return false;

    const attempts = row.attempt_count + 1;
    try {
      const conv = await getConversation(row.conversation_id);
      if (conv) {
        await addMessage({ conversation_id: conv.id, role: 'admin', content: row.content });
        broadcastConversationUpdate(conv.id);
        await dispatchReply(conv, row.content);
      }
      await tx
        .update(scheduled_messages)
        .set({ status: 'sent', sent_at: new Date(), attempt_count: attempts })
        .where(eq(scheduled_messages.id, row.id));
      await recordAudit({
        agency_id: row.agency_id,
        admin_id: row.created_by,
        actor_type: 'system',
        action: 'scheduled_message_sent',
        target_lead_id: row.lead_id
      });
    } catch (e) {
      // Retry until the cap, then mark failed so it stops looping.
      await tx
        .update(scheduled_messages)
        .set({
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempt_count: attempts,
          error: String(e).slice(0, 500)
        })
        .where(eq(scheduled_messages.id, row.id));
    }
    return true;
  });
}

export async function deliverDueScheduledMessages(): Promise<number> {
  const now = new Date();
  let delivered = 0;
  while (delivered < MAX_PER_TICK) {
    const got = await deliverOne(now);
    if (!got) break;
    delivered++;
  }
  return delivered;
}
