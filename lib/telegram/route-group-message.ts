/**
 * Pure group-message router for Phase 04.
 *
 * Classifies an inbound forum message by its message_thread_id against the
 * lead_telegram_topics table. The pure classification function is exported
 * separately so it can be unit-tested without hitting the DB.
 *
 * Routing table:
 *   threadId === conversation_topic_id  → 'topic1_conversation'  (💬 lead mirror)
 *   threadId === assistant_topic_id     → 'topic2_assistant'     (🤖 operator copilot)
 *   threadId is undefined / no match    → 'general' or 'unknown'
 */

import {
  getLeadTopicsByConversationTopic,
  getLeadTopicsByAssistantTopic,
  type LeadTelegramTopics
} from '@/lib/db/lead-telegram-topics';

export type ThreadKind =
  | 'topic1_conversation'
  | 'topic2_assistant'
  | 'general'
  | 'unknown';

export interface RouteResult {
  kind: ThreadKind;
  mapping?: LeadTelegramTopics;
}

/** Pure classification — decides kind given only integer ids. No I/O. */
export function classifyGroupThread(ids: {
  conversationTopicId: number | null;
  assistantTopicId: number | null;
  threadId: number | undefined;
}): ThreadKind {
  const { conversationTopicId, assistantTopicId, threadId } = ids;

  if (threadId === undefined) return 'general';

  if (conversationTopicId !== null && threadId === conversationTopicId)
    return 'topic1_conversation';

  if (assistantTopicId !== null && threadId === assistantTopicId)
    return 'topic2_assistant';

  return 'unknown';
}

/**
 * Resolve the full route for an inbound group message.
 *
 * Performs two DB lookups (conversation-topic reverse-lookup, then assistant-
 * topic reverse-lookup) so that only ONE query is needed in the happy path.
 * Security: both lookups are scoped by chatId — a thread id alone never
 * resolves cross-agency.
 */
export async function routeGroupMessage(
  chatId: string,
  threadId: number | undefined
): Promise<RouteResult> {
  if (threadId === undefined) {
    return { kind: 'general' };
  }

  // Try conversation topic first (most common inbound path).
  const byConv = await getLeadTopicsByConversationTopic(chatId, threadId);
  if (byConv) {
    return { kind: 'topic1_conversation', mapping: byConv };
  }

  // Try assistant topic.
  const byAsst = await getLeadTopicsByAssistantTopic(chatId, threadId);
  if (byAsst) {
    return { kind: 'topic2_assistant', mapping: byAsst };
  }

  return { kind: 'unknown' };
}
