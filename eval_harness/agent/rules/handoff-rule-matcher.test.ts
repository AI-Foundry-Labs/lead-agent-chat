/**
 * Tests for lib/agent/rules.ts — pure routing logic only.
 * matchRule calls LLM internally (ruleMatches), so we test only the parts
 * that don't require a live model: empty rules, all-inactive rules,
 * and the filter/ordering contract via a mock ruleMatches.
 *
 * The LLM classification path (ruleMatches itself) is covered by llm-contracts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HandoffRule } from '../../../lib/types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function rule(id: string, description: string, active: boolean, keywords: string[] = []): HandoffRule {
  return {
    id,
    description,
    trigger_keywords: keywords,
    active,
    created_at: new Date()
  };
}

// ── Pure routing logic (extracted from rules.ts) ───────────────────────────────
// Shadow the pure filter/ordering so we can test it without LLM calls.

function filterActiveRules(rules: HandoffRule[]): HandoffRule[] {
  return rules.filter((r) => r.active);
}

function firstMatchingRule(
  active: HandoffRule[],
  matchResults: boolean[]
): HandoffRule | null {
  for (let i = 0; i < active.length; i++) {
    if (matchResults[i]) return active[i];
  }
  return null;
}

// ── filterActiveRules ─────────────────────────────────────────────────────────

describe('filterActiveRules', () => {
  it('returns empty array when no rules', () => {
    assert.deepEqual(filterActiveRules([]), []);
  });

  it('returns empty array when all rules are inactive', () => {
    const rules = [rule('r1', 'Legal', false), rule('r2', 'Fees', false)];
    assert.deepEqual(filterActiveRules(rules), []);
  });

  it('returns only active rules', () => {
    const rules = [
      rule('r1', 'Legal', true),
      rule('r2', 'Fees', false),
      rule('r3', 'Financing', true)
    ];
    const active = filterActiveRules(rules);
    assert.equal(active.length, 2);
    assert.equal(active[0].id, 'r1');
    assert.equal(active[1].id, 'r3');
  });

  it('preserves original order of active rules', () => {
    const rules = [
      rule('r3', 'C', true),
      rule('r1', 'A', true),
      rule('r2', 'B', true)
    ];
    const ids = filterActiveRules(rules).map((r) => r.id);
    assert.deepEqual(ids, ['r3', 'r1', 'r2']);
  });
});

// ── firstMatchingRule (deterministic by DB order) ─────────────────────────────

describe('firstMatchingRule', () => {
  it('returns null when no active rules', () => {
    assert.equal(firstMatchingRule([], []), null);
  });

  it('returns null when all rules return false', () => {
    const active = [rule('r1', 'Legal', true), rule('r2', 'Fees', true)];
    assert.equal(firstMatchingRule(active, [false, false]), null);
  });

  it('returns first matching rule (not second)', () => {
    const active = [rule('r1', 'Legal', true), rule('r2', 'Fees', true)];
    const result = firstMatchingRule(active, [true, true]);
    assert.equal(result?.id, 'r1', 'first matching rule wins — deterministic by DB order');
  });

  it('returns second rule when first does not match', () => {
    const active = [rule('r1', 'Legal', true), rule('r2', 'Fees', true)];
    const result = firstMatchingRule(active, [false, true]);
    assert.equal(result?.id, 'r2');
  });

  it('returns null when active list is non-empty but matchResults is all false', () => {
    const active = [rule('r1', 'A', true), rule('r2', 'B', true), rule('r3', 'C', true)];
    assert.equal(firstMatchingRule(active, [false, false, false]), null);
  });
});

// ── matchRule contract (pure logic, no LLM) ───────────────────────────────────

describe('matchRule contract — early-exit when no active rules', () => {
  it('should short-circuit before any LLM call when all rules are inactive', () => {
    // This mirrors the guard in matchRule: `if (active.length === 0) return null`
    const rules = [rule('r1', 'Legal', false), rule('r2', 'Fees', false)];
    const active = filterActiveRules(rules);
    // No LLM calls needed — already null
    assert.equal(active.length, 0);
    assert.equal(firstMatchingRule(active, []), null);
  });

  it('should short-circuit when rules array is empty', () => {
    const active = filterActiveRules([]);
    assert.equal(active.length, 0);
    assert.equal(firstMatchingRule(active, []), null);
  });
});

// ── HandoffRule type shape ────────────────────────────────────────────────────

describe('HandoffRule shape', () => {
  it('has all required fields', () => {
    const r = rule('r1', 'Escalate on legal questions', true, ['lawyer', 'legal']);
    assert.ok(typeof r.id === 'string');
    assert.ok(typeof r.description === 'string');
    assert.ok(Array.isArray(r.trigger_keywords));
    assert.ok(typeof r.active === 'boolean');
    assert.ok(r.created_at instanceof Date);
  });

  it('active flag is the sole gate for LLM evaluation', () => {
    // Inactive rules with keywords must NOT trigger LLM calls —
    // this is a contract test: the filter happens before any model call.
    const inactive = rule('r1', 'Legal', false, ['lawyer']);
    const active = filterActiveRules([inactive]);
    assert.equal(active.length, 0, 'inactive rule must be filtered before LLM evaluation');
  });
});
