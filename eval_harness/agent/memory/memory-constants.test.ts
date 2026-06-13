/**
 * Tests for lib/agent/memory-constants.ts — guards against accidental changes
 * to the constants that control LLM context window size and memory caps.
 * Regressions here silently corrupt context quality or cause DB bloat.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHORT_TERM_WINDOW_TURNS,
  LONG_TERM_MEMORY_MAX_CHARS,
  LONG_TERM_MEMORY_TARGET_CHARS
} from '../../../lib/agent/memory-constants.ts';

describe('SHORT_TERM_WINDOW_TURNS', () => {
  it('is a positive integer', () => {
    assert.ok(Number.isInteger(SHORT_TERM_WINDOW_TURNS));
    assert.ok(SHORT_TERM_WINDOW_TURNS > 0);
  });

  it('is in a reasonable range (3–20 turns)', () => {
    assert.ok(SHORT_TERM_WINDOW_TURNS >= 3, 'too few turns risks losing recent context');
    assert.ok(SHORT_TERM_WINDOW_TURNS <= 20, 'too many turns wastes tokens per request');
  });
});

describe('LONG_TERM_MEMORY_MAX_CHARS', () => {
  it('is a positive integer', () => {
    assert.ok(Number.isInteger(LONG_TERM_MEMORY_MAX_CHARS));
    assert.ok(LONG_TERM_MEMORY_MAX_CHARS > 0);
  });

  it('fits within a safe token budget (~20k tokens at 4 chars/token)', () => {
    // 80 000 chars ≈ 20k tokens — fits in a 200k context window alongside prompt + messages
    assert.ok(LONG_TERM_MEMORY_MAX_CHARS <= 100_000, 'cap must leave headroom for the rest of the prompt');
  });
});

describe('LONG_TERM_MEMORY_TARGET_CHARS', () => {
  it('is less than MAX_CHARS (leaves headroom before the hard cap)', () => {
    assert.ok(LONG_TERM_MEMORY_TARGET_CHARS < LONG_TERM_MEMORY_MAX_CHARS);
  });

  it('is at least 50% of MAX_CHARS (not wastefully small)', () => {
    assert.ok(
      LONG_TERM_MEMORY_TARGET_CHARS >= LONG_TERM_MEMORY_MAX_CHARS * 0.5,
      'target should preserve most of the memory, not aggressively truncate'
    );
  });

  it('is a positive integer', () => {
    assert.ok(Number.isInteger(LONG_TERM_MEMORY_TARGET_CHARS));
    assert.ok(LONG_TERM_MEMORY_TARGET_CHARS > 0);
  });
});
