/**
 * Tests for lib/agent/thread-summary-schema.ts — the zod schema that
 * structures LLM output from short-term thread compression calls.
 * Verifies schema constraints so regressions are caught without running an LLM.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { threadSummaryResultSchema } from '../../../lib/agent/thread-summary-schema.ts';

describe('threadSummaryResultSchema — valid inputs', () => {
  it('accepts minimal valid output (need_memorize=false, empty facts)', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: '- Visitor asked about price\n- Agent confirmed €650k',
      need_memorize: false,
      memorize_facts: []
    });
    assert.ok(result.success);
  });

  it('accepts output with new facts to memorize', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: '- Budget confirmed at 700k€\n- Ready to visit next week',
      need_memorize: true,
      memorize_facts: ['Budget: 700k€', 'Timeline: next week']
    });
    assert.ok(result.success);
  });

  it('accepts up to 10 memorize_facts', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: 'long summary',
      need_memorize: true,
      memorize_facts: Array.from({ length: 10 }, (_, i) => `fact ${i}`)
    });
    assert.ok(result.success);
  });
});

describe('threadSummaryResultSchema — invalid inputs', () => {
  it('rejects summary exceeding 2000 chars', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: 'x'.repeat(2001),
      need_memorize: false,
      memorize_facts: []
    });
    assert.ok(!result.success);
  });

  it('rejects more than 10 memorize_facts', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: 'ok',
      need_memorize: true,
      memorize_facts: Array.from({ length: 11 }, (_, i) => `fact ${i}`)
    });
    assert.ok(!result.success);
  });

  it('rejects a single fact exceeding 300 chars', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: 'ok',
      need_memorize: true,
      memorize_facts: ['x'.repeat(301)]
    });
    assert.ok(!result.success);
  });

  it('rejects missing need_memorize field', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: 'ok',
      memorize_facts: []
    });
    assert.ok(!result.success);
  });

  it('rejects missing memorize_facts field', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: 'ok',
      need_memorize: false
    });
    assert.ok(!result.success);
  });

  it('rejects non-boolean need_memorize', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: 'ok',
      need_memorize: 'yes',
      memorize_facts: []
    });
    assert.ok(!result.success);
  });
});

describe('threadSummaryResultSchema — semantic constraint documentation', () => {
  it('allows need_memorize=true with empty facts array (schema does not enforce consistency)', () => {
    // Schema does not cross-validate need_memorize vs facts length —
    // that constraint is enforced by the LLM prompt instructions, not the schema.
    const result = threadSummaryResultSchema.safeParse({
      summary: 'ok',
      need_memorize: true,
      memorize_facts: []
    });
    assert.ok(result.success, 'schema allows this — prompt instruction enforces consistency');
  });

  it('allows need_memorize=false with non-empty facts (prompt should prevent this in practice)', () => {
    const result = threadSummaryResultSchema.safeParse({
      summary: 'ok',
      need_memorize: false,
      memorize_facts: ['some fact']
    });
    assert.ok(result.success, 'schema allows this — semantic enforcement is in the prompt');
  });
});
