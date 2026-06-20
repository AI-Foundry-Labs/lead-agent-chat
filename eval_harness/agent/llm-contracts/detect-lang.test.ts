/**
 * LLM contract tests for detectMessageLang — real FAST_MODEL call.
 * Skipped automatically when no API key is available in the environment.
 * Verifies behavioral contracts (output is always 'fr'|'en'), not exact wording.
 *
 * Run: ./eval_harness/run-tests.sh llm
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Language } from '../../../lib/types.ts';

// Derive the expected provider from FAST_MODEL env (default: openai/gpt-4o-mini)
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

describe('detectMessageLang — LLM contracts', () => {
  it('returns "en" for clear English input', { skip: SKIP, timeout: 15000 }, async () => {
    const { detectMessageLang } = await import('../../../lib/agent/detect-lang.ts');
    // Unambiguously English — no French words at all
    const result = await detectMessageLang(
      'Hi there! I am writing in English. Can you tell me more about the available properties?'
    );
    assert.equal(result, 'en', `Expected "en", got "${result}"`);
  });

  it('returns "fr" for clear French input', { skip: SKIP, timeout: 15000 }, async () => {
    const { detectMessageLang } = await import('../../../lib/agent/detect-lang.ts');
    const result = await detectMessageLang(
      'Bonjour, je souhaite en savoir plus sur le nombre de chambres et les espaces de rangement.'
    );
    assert.equal(result, 'fr', `Expected "fr", got "${result}"`);
  });

  it('returns "en" for a short English question', { skip: SKIP, timeout: 15000 }, async () => {
    const { detectMessageLang } = await import('../../../lib/agent/detect-lang.ts');
    const result = await detectMessageLang('Good morning! How many bedrooms are available?');
    assert.equal(result, 'en');
  });

  it('returns "fr" for a short French question', { skip: SKIP, timeout: 15000 }, async () => {
    const { detectMessageLang } = await import('../../../lib/agent/detect-lang.ts');
    const result = await detectMessageLang('Combien de pièces y a-t-il ?');
    assert.equal(result, 'fr');
  });

  it('output is always "fr" or "en" across varied inputs', { skip: SKIP, timeout: 30000 }, async () => {
    const { detectMessageLang } = await import('../../../lib/agent/detect-lang.ts');
    const samples: string[] = [
      'Hello, I am very interested in scheduling a viewing',
      'Bonjour, je suis très intéressé pour organiser une visite',
      'Can we arrange a meeting next week?',
      'Pouvons-nous organiser une réunion la semaine prochaine ?',
    ];
    for (const text of samples) {
      const result: Language = await detectMessageLang(text);
      assert.ok(
        result === 'fr' || result === 'en',
        `"${result}" is not a valid Language for input: "${text}"`
      );
    }
  });
});
