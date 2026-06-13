/**
 * Agency-scoped Telegram notification.
 *
 * Posts a handoff/alert message into:
 *   1. Topic 1 (💬 Conversation) of the lead's forum topics — lead-specific context.
 *   2. General topic (no message_thread_id) — agency-wide feed.
 *
 * Both sends are tagged kind:'critical' so they are never dropped under queue pressure.
 * Falls back to console log when no group or topic mapping is found — never throws.
 */

import { getAgencyById } from '@/lib/db/agencies';
import { getLeadTopicsByLead } from '@/lib/db/lead-telegram-topics';
import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';

export async function notifyAgency(
  agencyId: string,
  leadId: string,
  summary: string
): Promise<void> {
  try {
    const agency = await getAgencyById(agencyId);
    if (!agency?.telegram_group_chat_id) {
      console.log('[notify-agency] no telegram group for agency', agencyId, '—', summary);
      return;
    }

    const groupChatId = agency.telegram_group_chat_id;

    // Resolve Topic 1 for this lead (may be null for older leads).
    const topics = await getLeadTopicsByLead(agencyId, leadId);

    // Post into Topic 1 (lead-specific thread) if mapping exists.
    if (topics?.conversation_topic_id) {
      void enqueueGroupSend(groupChatId, summary, {
        threadId: topics.conversation_topic_id,
        kind: 'critical'
      });
    }

    // Post into General (agency-wide feed, no thread_id).
    void enqueueGroupSend(groupChatId, summary, { kind: 'critical' });
  } catch (e) {
    console.error('[notify-agency] failed — non-fatal:', e);
  }
}
