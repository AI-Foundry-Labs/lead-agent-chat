import { generateObject } from 'ai';
import { z } from 'zod';
import { FAST_MODEL } from '@/lib/llm';
import type { HandoffRule } from '@/lib/types';

const matchSchema = z.object({ matches: z.boolean() });

async function ruleMatches(rule: HandoffRule, message: string): Promise<boolean> {
  const prompt = `You decide if a lead's message should trigger a handoff rule.

HANDOFF RULE (plain language):
"${rule.description}"

LEAD MESSAGE:
"${message}"

Does the message clearly trigger this rule? Be strict — only true if the intent or
topic matches what the rule describes. Tangential mentions are false.`;
  try {
    const { object } = await generateObject({
      model: FAST_MODEL,
      schema: matchSchema,
      prompt
    });
    return object.matches;
  } catch (e) {
    console.error('[rules] matcher failed for rule', rule.id, e);
    return false;
  }
}

// First matching active rule wins (deterministic by DB order).
export async function matchRule(
  message: string,
  rules: HandoffRule[]
): Promise<HandoffRule | null> {
  const active = rules.filter((r) => r.active);
  if (active.length === 0) return null;
  const results = await Promise.all(active.map((r) => ruleMatches(r, message)));
  for (let i = 0; i < active.length; i++) if (results[i]) return active[i];
  return null;
}
