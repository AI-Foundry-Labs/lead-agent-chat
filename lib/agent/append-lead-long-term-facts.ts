import { generateText } from 'ai';
import { getLeadById, updateLead } from '@/lib/db';
import { FAST_MODEL } from '@/lib/llm';
import {
  LONG_TERM_MEMORY_MAX_CHARS,
  LONG_TERM_MEMORY_TARGET_CHARS
} from '@/lib/agent/memory-constants';

function clampMemory(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= LONG_TERM_MEMORY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, LONG_TERM_MEMORY_MAX_CHARS - 1)}…`;
}

async function mergeFactsIntoLeadMemory(
  leadId: string,
  facts: string[],
  contextNote?: string,
  threadTag?: string
): Promise<void> {
  const lead = await getLeadById(leadId);
  if (!lead) return;

  const newFacts = facts.map((f) => f.trim()).filter(Boolean);
  if (newFacts.length === 0) return;

  const existing = lead.long_term_memory?.trim() ?? '';
  const context = contextNote?.trim() ? `\n\nThread summary:\n${contextNote.slice(0, 400)}` : '';
  const tag = threadTag?.trim() ? `\nActive thread tag: ${threadTag}` : '';

  const { text } = await generateText({
    model: FAST_MODEL,
    system: `You maintain a compact UNIFIED visitor profile for a French real-estate agency.
The visitor may have SEPARATE chat threads (web, telegram, email) per listing — link them here.

Structure (keep under ${LONG_TERM_MEMORY_TARGET_CHARS} chars total):
1) IDENTITY — name, email, phone, language (dedupe)
2) PRODUCT — budget, financing, areas, property types, timeline, deal-breakers (dedupe, prefer newer)
3) THREAD NOTES — one bullet per channel/listing thread with key state, format:
   "[web · listing:marais · thread:abc12345] …" or "[telegram · listing:vincennes · thread:def67890] …"
   Include: listing interest, qualification progress, viewing booked, open questions.
Merge new facts; dedupe; prefer newer on conflict. Drop stale thread notes when superseded.`,
    prompt: `Existing profile:\n${existing || '(empty)'}\n\nNew facts:\n${newFacts.map((f) => `- ${f}`).join('\n')}${context}${tag}\n\nOutput updated profile with all three sections.`
  });

  await updateLead(leadId, { long_term_memory: clampMemory(text) });
}

/** Event/tool hook: merge explicit durable facts (background-safe). */
export async function appendLeadLongTermFacts(
  leadId: string,
  facts: string[],
  contextNote?: string,
  threadTag?: string
): Promise<void> {
  await mergeFactsIntoLeadMemory(leadId, facts, contextNote, threadTag);
}

export function scheduleAppendLeadLongTermFacts(
  leadId: string,
  facts: string[],
  contextNote?: string,
  threadTag?: string
): void {
  void appendLeadLongTermFacts(leadId, facts, contextNote, threadTag).catch((e) => {
    console.error('[memory] append long-term failed:', e);
  });
}
