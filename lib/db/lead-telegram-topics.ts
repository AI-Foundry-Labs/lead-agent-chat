import { and, eq } from 'drizzle-orm';
import { db, lead_telegram_topics } from './client';

export type LeadTelegramTopics = {
  id: string;
  agency_id: string;
  lead_id: string;
  group_chat_id: string;
  conversation_topic_id: number;
  assistant_topic_id: number;
  lead_conversation_id: string | null;
  operator_conversation_id: string | null;
  status: string;
  created_at: Date;
};

function rowToTopics(r: typeof lead_telegram_topics.$inferSelect): LeadTelegramTopics {
  return {
    id: r.id,
    agency_id: r.agency_id,
    lead_id: r.lead_id,
    group_chat_id: r.group_chat_id,
    conversation_topic_id: r.conversation_topic_id,
    assistant_topic_id: r.assistant_topic_id,
    lead_conversation_id: r.lead_conversation_id ?? null,
    operator_conversation_id: r.operator_conversation_id ?? null,
    status: r.status,
    created_at: r.created_at
  };
}

/** Fetch existing mapping for a lead in a specific agency. */
export async function getLeadTopicsByLead(
  agencyId: string,
  leadId: string
): Promise<LeadTelegramTopics | null> {
  const rows = await db
    .select()
    .from(lead_telegram_topics)
    .where(
      and(
        eq(lead_telegram_topics.agency_id, agencyId),
        eq(lead_telegram_topics.lead_id, leadId)
      )
    )
    .limit(1);
  return rows[0] ? rowToTopics(rows[0]) : null;
}

/**
 * Resolve which lead owns the 💬 Conversation topic (Phase 04 routing).
 * Looks up by group_chat_id + conversation_topic_id (message_thread_id).
 */
export async function getLeadTopicsByConversationTopic(
  groupChatId: string,
  threadId: number
): Promise<LeadTelegramTopics | null> {
  const rows = await db
    .select()
    .from(lead_telegram_topics)
    .where(
      and(
        eq(lead_telegram_topics.group_chat_id, groupChatId),
        eq(lead_telegram_topics.conversation_topic_id, threadId)
      )
    )
    .limit(1);
  return rows[0] ? rowToTopics(rows[0]) : null;
}

/**
 * Resolve which lead owns the 🤖 Assistant topic (Phase 04 routing).
 * Looks up by group_chat_id + assistant_topic_id (message_thread_id).
 */
export async function getLeadTopicsByAssistantTopic(
  groupChatId: string,
  threadId: number
): Promise<LeadTelegramTopics | null> {
  const rows = await db
    .select()
    .from(lead_telegram_topics)
    .where(
      and(
        eq(lead_telegram_topics.group_chat_id, groupChatId),
        eq(lead_telegram_topics.assistant_topic_id, threadId)
      )
    )
    .limit(1);
  return rows[0] ? rowToTopics(rows[0]) : null;
}

/**
 * Idempotent insert: ON CONFLICT DO NOTHING → re-select.
 * Caller should have already verified no mapping exists; this is the safe path
 * under concurrent webhook retries.
 */
export async function insertLeadTopics(input: {
  agency_id: string;
  lead_id: string;
  group_chat_id: string;
  conversation_topic_id: number;
  assistant_topic_id: number;
  lead_conversation_id: string | null;
  operator_conversation_id: string | null;
}): Promise<LeadTelegramTopics> {
  // ON CONFLICT DO NOTHING — duplicate (group_chat_id, lead_id) pair is silently skipped.
  await db
    .insert(lead_telegram_topics)
    .values({
      agency_id: input.agency_id,
      lead_id: input.lead_id,
      group_chat_id: input.group_chat_id,
      conversation_topic_id: input.conversation_topic_id,
      assistant_topic_id: input.assistant_topic_id,
      lead_conversation_id: input.lead_conversation_id,
      operator_conversation_id: input.operator_conversation_id
    })
    .onConflictDoNothing();

  // Re-select to return whatever row won (our insert or a concurrent one).
  const row = await getLeadTopicsByLead(input.agency_id, input.lead_id);
  if (!row) {
    // Should be unreachable: insert was either committed or a conflicting row exists.
    throw new Error(
      `[lead-telegram-topics] insertLeadTopics: re-select returned null for lead ${input.lead_id}`
    );
  }
  return row;
}

/** Mark a lead's topics as closed (e.g. on handoff completion or lead archival). */
export async function closeLeadTopics(leadId: string): Promise<void> {
  await db
    .update(lead_telegram_topics)
    .set({ status: 'closed' })
    .where(eq(lead_telegram_topics.lead_id, leadId));
}
