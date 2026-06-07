import { appendLeadLongTermFacts } from '@/lib/agent/append-lead-long-term-facts';

/**
 * Merge durable visitor facts into leads.long_term_memory.
 * Only called when short-term summarize sets need_memorize=true.
 */
export async function refreshLeadLongTermMemory(
  leadId: string,
  input: { facts: string[]; threadSummary: string; threadTag?: string }
): Promise<void> {
  await appendLeadLongTermFacts(leadId, input.facts, input.threadSummary, input.threadTag);
}
