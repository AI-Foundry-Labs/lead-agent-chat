import { db, admins } from '@/lib/db/client';
import { getOrCreateAdminAssistant } from '@/lib/db/conversations';
import { addMessage } from '@/lib/db/messages';
import { broadcastConversationUpdate } from '@/lib/events';
import { sendToLinkedAdmins } from '@/lib/telegram';

// Push an admin-facing notification. Goes to all linked Telegram admins; always
// logs as a fallback so nothing is silently lost in dev.
export async function notifyAdmins(summary: string): Promise<void> {
  console.log('[notify] admin:', summary);
  try {
    await sendToLinkedAdmins(`🔔 ${summary}`);
  } catch (e) {
    console.error('[notify] telegram fan-out failed:', e);
  }
}

// Inject a proactive message into every admin's assistant chat panel.
export async function notifyAdminsInChat(message: string): Promise<void> {
  let adminRows: { id: string }[] = [];
  try {
    adminRows = await db.select({ id: admins.id }).from(admins);
  } catch (e) {
    console.error('[notify] failed to fetch admins:', e);
    return;
  }
  await Promise.allSettled(
    adminRows.map(async ({ id }) => {
      const conv = await getOrCreateAdminAssistant(id);
      await addMessage({ conversation_id: conv.id, role: 'assistant', content: message });
      broadcastConversationUpdate(conv.id);
    })
  );
}
