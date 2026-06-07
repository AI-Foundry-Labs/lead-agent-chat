import { generateObject } from 'ai';
import { FAST_MODEL } from '@/lib/llm';
import {
  threadSummaryResultSchema,
  type ThreadSummaryResult
} from '@/lib/agent/thread-summary-schema';

const SUMMARIZE_SYSTEM = `You compress real-estate chat turns for an assistant's short-term thread memory.

summary: bullet points for THIS thread only (visitor questions, listing discussed, qualification progress, viewing intent, open questions). Drop greetings and filler. Same language as the chat.

need_memorize: set true ONLY when the NEW folded turns contain at least one of:
- Personal / identity: name, email, phone, household, job, language preference, contact details
- Product / transaction: budget range, financing status, buy vs sell intent, preferred areas or property types, rooms/surface needs, price ceiling/floor, investment vs primary home, purchase/sale timeline, stated deal-breakers

Set need_memorize false when turns are only: greetings, generic listing Q&A without personal prefs, scheduling logistics already known, chit-chat, or facts already in the prior summary.

memorize_facts: when need_memorize is true, list ONLY the new durable facts (not questions).
Each fact MUST be self-contained and tagged with channel + listing/thread when provided in the prompt,
e.g. "[web · listing:marais · thread:abc12345] Budget: 800k€, cash buyer".
When false, return [].`;

export async function summarizeFoldedTurns(args: {
  priorSummary: string | null;
  transcript: string;
  threadTag?: string;
}): Promise<ThreadSummaryResult> {
  const { priorSummary, transcript, threadTag } = args;
  const tagLine = threadTag ? `\nThread tag for memorize_facts: ${threadTag}\n` : '';
  const prompt = priorSummary
    ? `Prior thread summary:\n${priorSummary}\n\nNew turns to fold:\n${transcript}${tagLine}`
    : `Summarize these turns:\n${transcript}${tagLine}`;

  const { object } = await generateObject({
    model: FAST_MODEL,
    schema: threadSummaryResultSchema,
    system: SUMMARIZE_SYSTEM,
    prompt
  });

  return {
    summary: object.summary.trim().slice(0, 2000),
    need_memorize: object.need_memorize,
    memorize_facts: object.need_memorize
      ? object.memorize_facts.map((f) => f.trim()).filter(Boolean)
      : []
  };
}
