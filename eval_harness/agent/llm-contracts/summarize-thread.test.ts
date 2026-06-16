/**
 * LLM contract tests for summarizeFoldedTurns — real FAST_MODEL call.
 * Skipped automatically when no API key is available.
 * Verifies schema adherence and need_memorize behavioral contracts.
 *
 * Run: ./eval_harness/run-tests.sh llm
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { threadSummaryResultSchema } from '../../../lib/agent/thread-summary-schema.ts';

function hasLlmKey(): boolean {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  const fastModel = process.env.LLM_FAST_MODEL ?? 'openai/gpt-4o-mini';
  const provider = fastModel.split('/')[0];
  const keyMap: Record<string, string | undefined> = {
    openai:    process.env.OPENAI_API_KEY    ?? process.env.LLM_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY,
    google:    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.LLM_API_KEY,
  };
  return !!keyMap[provider];
}

const SKIP: string | undefined = hasLlmKey()
  ? undefined
  : 'No LLM API key — set LLM_API_KEY, provider-specific key, or AI_GATEWAY_API_KEY';

// Turns where the visitor reveals durable personal facts (budget + location + size)
const TRANSCRIPT_WITH_PERSONAL_INFO = `
user: Bonjour, mon budget est d'environ 750 000 euros et je cherche dans le 16ème arrondissement.
assistant: Très bien, je note votre budget de 750k€ et votre intérêt pour le 16ème. Vous cherchez combien de pièces ?
user: Au minimum 3 pièces, idéalement 4. Je suis acheteur cash, pas de crédit.
assistant: Parfait, je retiens : 3–4 pièces, achat comptant, secteur 16ème.
`.trim();

// Turns that are generic Q&A with no personal info
const TRANSCRIPT_GENERIC_QA = `
user: Quelles sont les charges de copropriété mensuelles ?
assistant: Les charges s'élèvent à 350€ par mois, incluant le gardiennage et l'entretien des parties communes.
user: Les parkings sont inclus dans ce montant ?
assistant: Non, les parkings sont en option à 150€ par mois.
`.trim();

describe('summarizeFoldedTurns — LLM schema and behavioral contracts', () => {
  it('output conforms to threadSummaryResultSchema', { skip: SKIP, timeout: 20000 }, async () => {
    const { summarizeFoldedTurns } = await import('../../../lib/agent/summarize-thread-turns.ts');
    const result = await summarizeFoldedTurns({ priorSummary: null, transcript: TRANSCRIPT_GENERIC_QA });
    const parsed = threadSummaryResultSchema.safeParse(result);
    assert.ok(parsed.success, `Schema validation failed: ${JSON.stringify(parsed.error?.issues)}`);
  });

  it('summary is non-empty', { skip: SKIP, timeout: 20000 }, async () => {
    const { summarizeFoldedTurns } = await import('../../../lib/agent/summarize-thread-turns.ts');
    const result = await summarizeFoldedTurns({ priorSummary: null, transcript: TRANSCRIPT_GENERIC_QA });
    assert.ok(result.summary.trim().length > 0, 'summary must not be empty');
  });

  it('sets need_memorize:true when transcript contains personal/financial facts', { skip: SKIP, timeout: 20000 }, async () => {
    const { summarizeFoldedTurns } = await import('../../../lib/agent/summarize-thread-turns.ts');
    const result = await summarizeFoldedTurns({
      priorSummary: null,
      transcript: TRANSCRIPT_WITH_PERSONAL_INFO,
      threadTag: 'web · listing:marais · thread:test01'
    });
    assert.ok(result.need_memorize, 'Expected need_memorize:true for transcript with budget, location, and financing info');
    assert.ok(result.memorize_facts.length > 0, 'Expected at least one memorize_fact when need_memorize is true');
  });

  it('sets need_memorize:false for generic Q&A with no personal info', { skip: SKIP, timeout: 20000 }, async () => {
    const { summarizeFoldedTurns } = await import('../../../lib/agent/summarize-thread-turns.ts');
    const result = await summarizeFoldedTurns({ priorSummary: null, transcript: TRANSCRIPT_GENERIC_QA });
    assert.equal(result.need_memorize, false, 'Generic Q&A should not trigger memorization');
  });

  it('memorize_facts is empty when need_memorize is false', { skip: SKIP, timeout: 20000 }, async () => {
    const { summarizeFoldedTurns } = await import('../../../lib/agent/summarize-thread-turns.ts');
    const result = await summarizeFoldedTurns({ priorSummary: null, transcript: TRANSCRIPT_GENERIC_QA });
    // summarizeFoldedTurns enforces this in its return — LLM output is overridden when false
    assert.deepEqual(result.memorize_facts, [], 'memorize_facts must be [] when need_memorize is false');
  });

  it('summary stays within 2000 char cap', { skip: SKIP, timeout: 20000 }, async () => {
    const { summarizeFoldedTurns } = await import('../../../lib/agent/summarize-thread-turns.ts');
    const result = await summarizeFoldedTurns({ priorSummary: null, transcript: TRANSCRIPT_WITH_PERSONAL_INFO });
    assert.ok(result.summary.length <= 2000, `summary exceeded 2000 chars: ${result.summary.length}`);
  });
});
