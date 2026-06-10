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
    system: `You maintain a comprehensive UNIFIED visitor profile for a French real-estate agency.
The visitor may have SEPARATE chat threads (web, telegram, email) per listing — link them here.

Structure (keep under ${LONG_TERM_MEMORY_TARGET_CHARS} chars total):
1) IDENTITY — name, email, phone, language, preferred contact channel (dedupe)
2) PRODUCT — budget, financing status, areas of interest, property types, rooms, floor preference, timeline, deal-breakers, intended use (dedupe, prefer newer)
3) PURCHASE STATUS — current stage (browsing / qualified / viewing_scheduled / viewing_done / negotiating / booked / cancelled / abandoned), history of viewings (listing, slot, outcome: attended/cancelled/rescheduled), any offers made, objections raised, reasons for cancellations
4) ADMIN ACTIONS — cancellations sent, follow-ups sent, manual takeovers, operator briefings done, last admin contact date and content summary
5) THREAD NOTES — one bullet per channel/listing thread with key state, format:
   "[web · listing:marais · thread:abc12345] …" or "[telegram · listing:vincennes · thread:def67890] …"
   Include: listing interest, qualification progress, viewing status, agent replies, open questions.

Rules:
- Merge new facts; dedupe; prefer newer on conflict.
- Drop stale thread notes only when superseded by confirmed newer info.
- In PURCHASE STATUS, always append new events (never silently overwrite viewing history).
- Be verbose and detailed — storage is generous, capture everything useful.`,
    prompt: `Existing profile:\n${existing || '(empty)'}\n\nNew facts:\n${newFacts.map((f) => `- ${f}`).join('\n')}${context}${tag}\n\nOutput updated profile with all five sections.`
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
