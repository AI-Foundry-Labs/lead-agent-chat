import { type ModelMessage } from 'ai';
import {
  getConversation,
  getVisibleMessages,
  updateConversation
} from '@/lib/db';
import { SHORT_TERM_WINDOW_TURNS } from '@/lib/agent/memory-constants';
import { refreshLeadLongTermMemory } from '@/lib/agent/lead-long-term-memory';
import { summarizeFoldedTurns } from '@/lib/agent/summarize-thread-turns';
import { threadMemoryTag } from '@/lib/agent/cross-thread-context';
import {
  flattenRecentTurns,
  formatTurnsForSummary,
  groupMessagesIntoTurns
} from '@/lib/agent/thread-turns';

function toModelMessages(
  msgs: { role: string; content: string }[]
): ModelMessage[] {
  return msgs
    .filter((m) => m.role !== 'tool')
    .map((m) => ({
      role: (m.role === 'user' || m.role === 'system') ? 'user' : 'assistant',
      content: m.content
    }));
}

/** Build LLM transcript: optional rolled summary + last N raw turns only. */
export async function buildThreadContextMessages(
  conversationId: string
): Promise<ModelMessage[]> {
  const [conversation, messages] = await Promise.all([
    getConversation(conversationId),
    getVisibleMessages(conversationId)
  ]);
  if (!conversation) return [];

  const turns = groupMessagesIntoTurns(messages);
  const recent = flattenRecentTurns(turns.slice(-SHORT_TERM_WINDOW_TURNS));
  const modelMessages = toModelMessages(recent);

  if (conversation.thread_summary?.trim()) {
    return [
      {
        role: 'assistant',
        content: `[Earlier in this conversation — summary]\n${conversation.thread_summary.trim()}`
      },
      ...modelMessages
    ];
  }
  return modelMessages;
}

/**
 * After a lead turn completes: fold oldest raw turns into thread_summary when
 * the thread exceeds SHORT_TERM_WINDOW_TURNS. Runs in the background (fire-and-forget).
 */
export async function summarizeThreadMemoryBackground(
  conversationId: string
): Promise<void> {
  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.type !== 'lead') return;

  const messages = await getVisibleMessages(conversationId);
  const turns = groupMessagesIntoTurns(messages);
  const totalTurns = turns.length;
  const keepRaw = SHORT_TERM_WINDOW_TURNS;
  const targetSummarized = Math.max(0, totalTurns - keepRaw);

  if (targetSummarized <= conversation.summarized_turn_count) return;

  const turnsToFold = turns.slice(
    conversation.summarized_turn_count,
    targetSummarized
  );
  if (turnsToFold.length === 0) return;

  const transcript = formatTurnsForSummary(turnsToFold);
  const prior = conversation.thread_summary?.trim() ?? null;
  const threadTag = await threadMemoryTag(conversationId);

  const result = await summarizeFoldedTurns({
    priorSummary: prior,
    transcript,
    threadTag
  });

  await updateConversation(conversationId, {
    thread_summary: result.summary,
    summarized_turn_count: targetSummarized
  });

  if (conversation.lead_id && result.need_memorize) {
    await refreshLeadLongTermMemory(conversation.lead_id, {
      facts: result.memorize_facts,
      threadSummary: result.summary,
      threadTag
    });
  }
}

export function scheduleThreadMemorySummarize(conversationId: string): void {
  void summarizeThreadMemoryBackground(conversationId).catch((e) => {
    console.error('[memory] thread summarize failed:', e);
  });
}
