/**
 * syncLeadTopicTitles — keep BOTH of a lead's forum topic titles in sync with the
 * lead's current display name.
 *
 * The two topics are created once with whatever name the lead had at the time
 * (often "Visiteur #N" while anonymous). When the lead later gains a real name
 * (e.g. captured at booking or Google login), both titles must update together —
 * otherwise the 💬 Conversation topic shows "Dung" while the 🤖 Assistant topic
 * still shows "Visiteur #3" for the same person.
 *
 * Title shape:
 *   💬 Conversation: "{emoji?} 💬 {name} — {listing}"  (emoji = hot/warm/cold marker)
 *   🤖 Assistant:    "🤖 {name} — Assistant"            (no status emoji)
 *
 * The Conversation topic carries the potential-status emoji (read from the lead's
 * current potential_status) so a name re-sync never drops a previously-set marker.
 *
 * No-op when the lead has no topics (agency unlinked / topics disabled). Guarded
 * at call sites: never throws into the agent turn.
 *
 * Returns true if the 💬 Conversation topic was successfully renamed (used by the
 * status marker to decide whether to also post a status notice).
 */
import type { PotentialStatus } from '@/lib/types';
import { getLeadById } from '@/lib/db/leads';
import { getListing } from '@/lib/db/listings';
import { getLeadTopicsByLead } from '@/lib/db/lead-telegram-topics';
import { editForumTopic } from '@/lib/telegram';
import {
  buildLeadDisplayName,
  buildConversationTopicTitle,
  buildAssistantTopicTitle
} from './lead-topics';

export const STATUS_EMOJI: Record<PotentialStatus, string> = {
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

export async function syncLeadTopicTitles(
  agencyId: string,
  leadId: string
): Promise<boolean> {
  // Agency-scoped lookup is the tenant guard — a cross-tenant leadId returns null
  // here, so the unscoped getLeadById below can't read another agency's lead.
  const topics = await getLeadTopicsByLead(agencyId, leadId);
  if (!topics?.group_chat_id) return false;

  const lead = await getLeadById(leadId);
  if (!lead) return false;
  const listing = lead.listing_id ? await getListing(lead.listing_id) : null;

  const name = buildLeadDisplayName(lead.name, lead.email, lead.anon_seq);
  const emoji = lead.potential_status ? STATUS_EMOJI[lead.potential_status] : '';

  let conversationRenamed = false;
  if (topics.conversation_topic_id) {
    const base = buildConversationTopicTitle(name, listing?.title);
    const title = clampTitle(emoji ? `${emoji} ${base}` : base);
    conversationRenamed = await editForumTopic(
      topics.group_chat_id,
      topics.conversation_topic_id,
      title
    );
  }
  if (topics.assistant_topic_id) {
    const title = clampTitle(buildAssistantTopicTitle(name));
    await editForumTopic(topics.group_chat_id, topics.assistant_topic_id, title);
  }

  return conversationRenamed;
}
