import { and, desc, eq } from 'drizzle-orm';
import { db, messages } from './client';
import type { Message, MessageRole } from '@/lib/types';

function rowToMessage(r: typeof messages.$inferSelect): Message {
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    role: r.role as MessageRole,
    content: r.content,
    tool_calls: r.tool_calls,
    tool_results: r.tool_results,
    is_draft: r.is_draft,
    timestamp: r.timestamp
  };
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, conversationId))
    .orderBy(messages.timestamp);
  return rows.map(rowToMessage);
}

export async function getVisibleMessages(
  conversationId: string
): Promise<Message[]> {
  // Excludes drafts; used to build the LLM transcript + the rendered thread.
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversation_id, conversationId),
        eq(messages.is_draft, false)
      )
    )
    .orderBy(messages.timestamp);
  return rows.map(rowToMessage);
}

export async function addMessage(input: {
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_calls?: unknown | null;
  tool_results?: unknown | null;
  is_draft?: boolean;
}): Promise<Message> {
  const [r] = await db
    .insert(messages)
    .values({
      conversation_id: input.conversation_id,
      role: input.role,
      content: input.content,
      tool_calls: input.tool_calls ?? null,
      tool_results: input.tool_results ?? null,
      is_draft: input.is_draft ?? false
    })
    .returning();
  return rowToMessage(r);
}

/**
 * Delete ALL messages of a conversation. Used by the Master agent /reset command
 * to wipe chat history. Returns the number of rows removed.
 */
export async function clearConversationMessages(
  conversationId: string
): Promise<number> {
  const rows = await db
    .delete(messages)
    .where(eq(messages.conversation_id, conversationId))
    .returning({ id: messages.id });
  return rows.length;
}

export async function getLastVisibleMessage(
  conversationId: string
): Promise<Message | null> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversation_id, conversationId),
        eq(messages.is_draft, false)
      )
    )
    .orderBy(desc(messages.timestamp))
    .limit(1);
  return rows[0] ? rowToMessage(rows[0]) : null;
}

export async function getLatestDraft(
  conversationId: string
): Promise<Message | null> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversation_id, conversationId),
        eq(messages.is_draft, true)
      )
    )
    .orderBy(desc(messages.timestamp))
    .limit(1);
  return rows[0] ? rowToMessage(rows[0]) : null;
}

export async function promoteDraftToSent(
  messageId: string,
  newContent?: string
): Promise<Message> {
  const patch: { is_draft: boolean; content?: string; timestamp: Date } = {
    is_draft: false,
    timestamp: new Date()
  };
  if (newContent !== undefined) patch.content = newContent;
  const [r] = await db
    .update(messages)
    .set(patch)
    .where(eq(messages.id, messageId))
    .returning();
  return rowToMessage(r);
}
