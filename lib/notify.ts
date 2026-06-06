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
