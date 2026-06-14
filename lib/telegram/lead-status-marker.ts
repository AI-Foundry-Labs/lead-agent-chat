/**
 * syncLeadStatusToTelegram — surface a lead's potential status (hot/warm/cold)
 * in the agency's Telegram group.
 *
 * On a status CHANGE it:
 *   1. Prepends a status emoji to the 💬 Conversation topic title (via editForumTopic).
 *   2. Posts a one-line status notice into that topic (critical send — never dropped).
 *
 * No-op (returns without side effects) when:
 *   - the status didn't actually change (old === next) or next is null,
 *   - the lead has no forum topics yet (agency not linked / topics disabled),
 *   - any Telegram call fails (logged, swallowed — must never break the agent turn).
 *
 * Title is rebuilt from the same builders used at topic creation so the lead's
 * display name + listing stay intact; only the leading emoji changes.
 */
import type { PotentialStatus } from '@/lib/types';
import { getLeadById } from '@/lib/db/leads';
import { getListing } from '@/lib/db/listings';
import { getLeadTopicsByLead } from '@/lib/db/lead-telegram-topics';
import { editForumTopic } from '@/lib/telegram';
import { enqueueGroupSend } from './group-send-queue';
import { buildLeadDisplayName, buildConversationTopicTitle } from './lead-topics';

const STATUS_EMOJI: Record<PotentialStatus, string> = {
  hot: '🔥',
  warm: '🟡',
  cold: '❄️'
};

// Telegram forum topic names are capped at 128 chars. Truncate with an ellipsis.
const TG_TOPIC_NAME_MAX = 128;
function clampTitle(title: string): string {
  return title.length <= TG_TOPIC_NAME_MAX
    ? title
    : `${title.slice(0, TG_TOPIC_NAME_MAX - 1)}…`;
}

export async function syncLeadStatusToTelegram(
  agencyId: string,
  leadId: string,
  oldStatus: PotentialStatus | null,
  nextStatus: PotentialStatus | null | undefined,
  reason: string
): Promise<void> {
  // Only act on a real change to a concrete status.
  if (!nextStatus || nextStatus === oldStatus) return;

  // NOTE: the agency-scoped topic lookup below is the tenant guard — it returns
  // null for a cross-tenant leadId, so the unscoped getLeadById that follows can
  // never read another agency's lead. Keep this ordering on any refactor.
  const topics = await getLeadTopicsByLead(agencyId, leadId);
  if (!topics?.group_chat_id || !topics.conversation_topic_id) return;

  const lead = await getLeadById(leadId);
  if (!lead) return;
  const listing = lead.listing_id ? await getListing(lead.listing_id) : null;

  const emoji = STATUS_EMOJI[nextStatus];
  const displayName = buildLeadDisplayName(lead.name, lead.email, lead.anon_seq);
  const baseTitle = buildConversationTopicTitle(displayName, listing?.title);
  // Telegram caps forum topic names at 128 chars; clamp so the rename never 400s.
  const title = clampTitle(`${emoji} ${baseTitle}`);

  // Rename the topic so the status is visible in the group's topic list.
  // If the rename fails (e.g. missing can_manage_topics), skip the notice too so
  // the title and the in-topic message can't disagree.
  const renamed = await editForumTopic(topics.group_chat_id, topics.conversation_topic_id, title);
  if (!renamed) return;

  // Post a status notice (critical: status changes are never dropped under load).
  const notice = reason.trim()
    ? `${emoji} Statut: ${nextStatus.toUpperCase()} — ${reason.trim()}`
    : `${emoji} Statut: ${nextStatus.toUpperCase()}`;
  void enqueueGroupSend(topics.group_chat_id, notice, {
    threadId: topics.conversation_topic_id,
    kind: 'critical'
  });
}
