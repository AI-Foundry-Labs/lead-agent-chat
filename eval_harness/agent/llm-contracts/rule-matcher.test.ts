/**
 * LLM contract tests for matchRule — real FAST_MODEL call to ruleMatches.
 * Skipped automatically when no API key is available.
 * Tests the LLM classification path: clear match, clear non-match, ordering.
 *
 * Pure logic (no-rules, all-inactive) is already covered in:
 *   eval_harness/agent/rules/handoff-rule-matcher.test.ts
 *
 * Run: ./eval_harness/run-tests.sh llm
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HandoffRule } from '../../../lib/types.ts';

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

function rule(id: string, description: string, active = true): HandoffRule {
  return { id, agency_id: 'agency-test', description, trigger_keywords: [], active };
}

describe('matchRule — LLM classification contracts', () => {
  it('returns the rule when message clearly matches', { skip: SKIP, timeout: 20000 }, async () => {
    const { matchRule } = await import('../../../lib/agent/rules.ts');
    const rules = [rule('r1', 'Lead explicitly asks to speak with a human agent or advisor')];
    const matched = await matchRule('I would like to speak with a real person please.', rules);
    assert.ok(matched !== null, 'Expected a match but got null');
    assert.equal(matched.id, 'r1');
  });

  it('returns null when message clearly does not match', { skip: SKIP, timeout: 20000 }, async () => {
    const { matchRule } = await import('../../../lib/agent/rules.ts');
    const rules = [rule('r1', 'Lead explicitly asks to speak with a human agent or advisor')];
    const matched = await matchRule('What is the surface area of the apartment?', rules);
    assert.equal(matched, null, `Expected null but matched rule "${matched?.id}"`);
  });

  it('returns null for an irrelevant message against a budget-related rule', { skip: SKIP, timeout: 20000 }, async () => {
    const { matchRule } = await import('../../../lib/agent/rules.ts');
    const rules = [rule('r2', 'Lead states their budget exceeds 2 000 000 euros')];
    const matched = await matchRule('Can I visit the property this weekend?', rules);
    assert.equal(matched, null);
  });

  it('returns first matching rule when multiple rules are active (ordering contract)', { skip: SKIP, timeout: 25000 }, async () => {
    const { matchRule } = await import('../../../lib/agent/rules.ts');
    const rules = [
      rule('r1', 'Lead explicitly asks to speak with a human agent or advisor'),
      rule('r2', 'Lead mentions they want to make an offer on the property'),
    ];
    // This message matches r1, should return r1 (first match wins)
    const matched = await matchRule('Can I talk to an agent directly?', rules);
    assert.ok(matched !== null, 'Expected a match');
    assert.equal(matched.id, 'r1', `Expected r1 to win but got "${matched.id}"`);
  });

  it('returns null when all rules are inactive — no LLM call needed', { skip: SKIP, timeout: 15000 }, async () => {
    const { matchRule } = await import('../../../lib/agent/rules.ts');
    const rules = [
      rule('r1', 'Lead asks for a human agent', false),
      rule('r2', 'Lead wants to make an offer', false),
    ];
    const matched = await matchRule('I want to speak to a human and make an offer.', rules);
    assert.equal(matched, null, 'Inactive rules must never match regardless of message');
  });
});
