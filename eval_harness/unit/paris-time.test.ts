/**
 * Unit tests for Europe/Paris wall-clock ↔ UTC conversion (F4a). No DB, no LLM.
 * Verifies CEST (+2 summer) and CET (+1 winter) are applied correctly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parisLocalToUtc } from '../../lib/scheduling/paris-time.ts';

describe('parisLocalToUtc', () => {
  it('applies CEST (+2) in summer', () => {
    // 2026-07-15 14:30 Paris (CEST) == 12:30 UTC
    const utc = parisLocalToUtc('2026-07-15 14:30');
    assert.ok(utc);
    assert.equal(utc!.toISOString(), '2026-07-15T12:30:00.000Z');
  });

  it('applies CET (+1) in winter', () => {
    // 2026-01-15 14:30 Paris (CET) == 13:30 UTC
    const utc = parisLocalToUtc('2026-01-15 14:30');
    assert.ok(utc);
    assert.equal(utc!.toISOString(), '2026-01-15T13:30:00.000Z');
  });

  it('accepts the T separator', () => {
    const utc = parisLocalToUtc('2026-07-15T09:00');
    assert.equal(utc!.toISOString(), '2026-07-15T07:00:00.000Z');
  });

  it('returns null on malformed input', () => {
    assert.equal(parisLocalToUtc('not-a-date'), null);
    assert.equal(parisLocalToUtc('2026/07/15 14:30'), null);
  });
});
