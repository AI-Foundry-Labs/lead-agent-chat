/**
 * syncLeadStatusToTelegram — surface a lead's potential status (hot/warm/cold)
 * in the agency's Telegram group.
 *
 * On a status CHANGE it:
 *   1. Re-titles BOTH topics from current lead state (delegated to syncLeadTopicTitles),
 *      which applies the hot/warm/cold emoji to the 💬 Conversation topic.
 *   2. Posts a one-line status notice into the Conversation topic (critical send).
 *
 * No-op when the status didn't change (old === next) or next is null, the lead has
 * no topics, or the rename fails. Guarded at the call site: never throws into the turn.
 *
 * IMPORTANT: caller must persist the new potential_status on the lead BEFORE calling
 * this — the emoji is read from the lead's current potential_status inside
 * syncLeadTopicTitles, not from the nextStatus argument.
 */
import type { PotentialStatus } from '@/lib/types';
import { getLeadTopicsByLead } from '@/lib/db/lead-telegram-topics';
import { enqueueGroupSend } from './group-send-queue';
import { syncLeadTopicTitles, STATUS_EMOJI } from './sync-lead-topic-titles';

export async function syncLeadStatusToTelegram(
  agencyId: string,
  leadId: string,
  oldStatus: PotentialStatus | null,
  nextStatus: PotentialStatus | null | undefined,
  reason: string
): Promise<void> {
  // Only act on a real change to a concrete status.
  if (!nextStatus || nextStatus === oldStatus) return;

  // Re-title both topics (Conversation gets the status emoji). If the Conversation
  // rename fails, skip the notice so the title and message can't disagree.
  const renamed = await syncLeadTopicTitles(agencyId, leadId);
  if (!renamed) return;

  const topics = await getLeadTopicsByLead(agencyId, leadId);
  if (!topics?.group_chat_id || !topics.conversation_topic_id) return;

  const emoji = STATUS_EMOJI[nextStatus];
  const notice = reason.trim()
    ? `${emoji} Statut: ${nextStatus.toUpperCase()} — ${reason.trim()}`
    : `${emoji} Statut: ${nextStatus.toUpperCase()}`;
  void enqueueGroupSend(topics.group_chat_id, notice, {
    threadId: topics.conversation_topic_id,
    kind: 'critical'
  });
}
