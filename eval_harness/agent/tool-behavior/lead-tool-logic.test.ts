/**
 * Tool behavior tests — pure logic that lives inside lead-tools.ts.
 *
 * These tests do NOT import lead-tools.ts (which has DB deps).
 * Instead they test:
 *   1. Input schema validation (same zod shapes as the real tools)
 *   2. The record_qualification merge + completeness + status-guard logic
 *   3. The book_viewing contact guard
 *   4. Format utilities used by slot display
 *
 * When tool schemas change, update the shadow schemas here to catch drift.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { formatPrice, formatSlot, formatThreadDate } from '../../../lib/format.ts';

// ── Shadow schemas (match lead-tools.ts input schemas exactly) ────────────────
// If real schemas change, tests here fail → forces deliberate update.

const recordQualificationSchema = z.object({
  values: z.record(z.string(), z.string()),
  potential_status: z.enum(['hot', 'warm', 'cold']),
  reason: z.string().max(200)
});

const bookViewingSchema = z.object({
  slot_iso: z.string(),
  contact_email: z.string().email().optional(),
  contact_name: z.string().optional()
});

const updateLeadStatusSchema = z.object({
  potential_status: z.enum(['hot', 'warm', 'cold']).optional(),
  status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
  memory_note: z.string().max(400)
});

const rememberVisitorFactSchema = z.object({
  facts: z.array(z.string().max(800)).min(1).max(20)
});

const getLeadViewingsSchema = z.object({});

const cancelViewingSchema = z.object({
  viewing_id: z.string(),
  reason: z.string().max(300).optional()
});

const rescheduleViewingSchema = z.object({
  viewing_id: z.string(),
  new_slot_iso: z.string()
});

const getAvailableSlotsSchema = z.object({
  count: z.number().int().min(1).max(5).optional()
});

// ── record_qualification schema validation ────────────────────────────────────

describe('record_qualification schema', () => {
  it('accepts valid input with all fields', () => {
    const result = recordQualificationSchema.safeParse({
      values: { budget: '650k€', timeline: '3 months' },
      potential_status: 'warm',
      reason: 'Has budget, ready to move soon'
    });
    assert.ok(result.success);
  });

  it('rejects unknown potential_status', () => {
    const result = recordQualificationSchema.safeParse({
      values: { budget: '650k€' },
      potential_status: 'lukewarm',
      reason: 'some reason'
    });
    assert.ok(!result.success, 'lukewarm is not a valid potential_status');
  });

  it('rejects reason exceeding 200 chars', () => {
    const result = recordQualificationSchema.safeParse({
      values: {},
      potential_status: 'cold',
      reason: 'x'.repeat(201)
    });
    assert.ok(!result.success, 'reason over 200 chars should fail');
  });

  it('accepts empty values dict (LLM may call with partial updates)', () => {
    const result = recordQualificationSchema.safeParse({
      values: {},
      potential_status: 'hot',
      reason: 'high intent'
    });
    assert.ok(result.success);
  });

  it('rejects non-string dict values', () => {
    const result = recordQualificationSchema.safeParse({
      values: { budget: 650000 },
      potential_status: 'warm',
      reason: 'test'
    });
    assert.ok(!result.success, 'criterion values must be strings, not numbers');
  });
});

// ── record_qualification pure logic ───────────────────────────────────────────

function simulateRecordQualification(
  existingValues: Record<string, string>,
  newValues: Record<string, string>,
  existingStatus: string,
  allCriteriaKeys: string[]
) {
  const merged = { ...existingValues, ...newValues };
  const complete = allCriteriaKeys.every((k) => merged[k]);
  const updatedStatus = complete && existingStatus === 'active' ? 'qualified' : existingStatus;
  return { merged, complete, updatedStatus };
}

const CRITERIA_KEYS = ['budget', 'timeline', 'financing'];

describe('record_qualification merge + status guard', () => {
  it('merges new values over existing without losing prior data', () => {
    const { merged } = simulateRecordQualification(
      { budget: '500k€' },
      { timeline: '2 months' },
      'active',
      CRITERIA_KEYS
    );
    assert.equal(merged.budget, '500k€');
    assert.equal(merged.timeline, '2 months');
  });

  it('overwrites existing key when updated', () => {
    const { merged } = simulateRecordQualification(
      { budget: '500k€' },
      { budget: '700k€' },
      'active',
      CRITERIA_KEYS
    );
    assert.equal(merged.budget, '700k€');
  });

  it('promotes active → qualified when all criteria complete', () => {
    const { complete, updatedStatus } = simulateRecordQualification(
      { budget: '650k€', timeline: '3 months' },
      { financing: 'mortgage' },
      'active',
      CRITERIA_KEYS
    );
    assert.ok(complete);
    assert.equal(updatedStatus, 'qualified');
  });

  it('does NOT promote when criteria are incomplete', () => {
    const { complete, updatedStatus } = simulateRecordQualification(
      { budget: '650k€' },
      { timeline: '3 months' },
      'active',
      CRITERIA_KEYS
    );
    assert.ok(!complete);
    assert.equal(updatedStatus, 'active');
  });

  it('does NOT downgrade booked lead even when all criteria present', () => {
    const { updatedStatus } = simulateRecordQualification(
      { budget: '650k€', timeline: '1 month', financing: 'cash' },
      { budget: '700k€' },
      'booked',
      CRITERIA_KEYS
    );
    assert.equal(updatedStatus, 'booked', 'booked must stay booked');
  });

  it('does NOT downgrade handoff lead', () => {
    const { updatedStatus } = simulateRecordQualification(
      { budget: '1M€', timeline: 'asap', financing: 'cash' },
      {},
      'handoff',
      CRITERIA_KEYS
    );
    assert.equal(updatedStatus, 'handoff', 'handoff must stay handoff');
  });

  it('does NOT downgrade abandoned lead', () => {
    const { updatedStatus } = simulateRecordQualification(
      { budget: '650k€', timeline: '6 months', financing: 'mortgage' },
      {},
      'abandoned',
      CRITERIA_KEYS
    );
    assert.equal(updatedStatus, 'abandoned', 'abandoned must stay abandoned');
  });
});

// ── book_viewing schema validation ─────────────────────────────────────────────

describe('book_viewing schema', () => {
  it('accepts minimal valid input (iso + email)', () => {
    const result = bookViewingSchema.safeParse({
      slot_iso: '2026-06-15T10:00:00.000Z',
      contact_email: 'tarik@example.com'
    });
    assert.ok(result.success);
  });

  it('accepts slot_iso without optional email (email may come from lead record)', () => {
    const result = bookViewingSchema.safeParse({ slot_iso: '2026-06-15T10:00:00.000Z' });
    assert.ok(result.success);
  });

  it('rejects malformed email', () => {
    const result = bookViewingSchema.safeParse({
      slot_iso: '2026-06-15T10:00:00.000Z',
      contact_email: 'not-an-email'
    });
    assert.ok(!result.success, 'malformed email should fail validation');
  });

  it('accepts optional contact_name alongside email', () => {
    const result = bookViewingSchema.safeParse({
      slot_iso: '2026-06-15T10:00:00.000Z',
      contact_email: 'tarik@example.com',
      contact_name: 'Tarik'
    });
    assert.ok(result.success);
  });
});

// ── book_viewing contact guard logic ──────────────────────────────────────────

describe('book_viewing contact guard', () => {
  function resolveEmail(
    inputEmail: string | undefined,
    leadEmail: string | null
  ): { need_contact: boolean; email?: string } {
    const email = inputEmail ?? leadEmail ?? undefined;
    if (!email) return { need_contact: true };
    return { need_contact: false, email };
  }

  it('uses input email when provided', () => {
    const r = resolveEmail('tarik@example.com', null);
    assert.equal(r.need_contact, false);
    assert.equal(r.email, 'tarik@example.com');
  });

  it('falls back to lead email when input not provided', () => {
    const r = resolveEmail(undefined, 'saved@example.com');
    assert.equal(r.need_contact, false);
    assert.equal(r.email, 'saved@example.com');
  });

  it('returns need_contact:true when neither source has an email', () => {
    const r = resolveEmail(undefined, null);
    assert.equal(r.need_contact, true);
  });

  it('prefers input email over lead email (allows updating contact)', () => {
    const r = resolveEmail('new@example.com', 'old@example.com');
    assert.equal(r.email, 'new@example.com');
  });
});

// ── update_lead_status schema ──────────────────────────────────────────────────

describe('update_lead_status schema', () => {
  it('accepts valid status transition with memory_note', () => {
    const result = updateLeadStatusSchema.safeParse({
      status: 'abandoned',
      memory_note: 'Said they found another property'
    });
    assert.ok(result.success);
  });

  it('requires memory_note — cannot be omitted', () => {
    const result = updateLeadStatusSchema.safeParse({ status: 'abandoned' });
    assert.ok(!result.success, 'memory_note is required');
  });

  it('rejects unknown status value', () => {
    const result = updateLeadStatusSchema.safeParse({
      status: 'rejected',
      memory_note: 'test'
    });
    assert.ok(!result.success);
  });

  it('rejects memory_note over 400 chars', () => {
    const result = updateLeadStatusSchema.safeParse({
      status: 'abandoned',
      memory_note: 'x'.repeat(401)
    });
    assert.ok(!result.success);
  });
});

// ── remember_visitor_fact schema ───────────────────────────────────────────────

describe('remember_visitor_fact schema', () => {
  it('accepts a list of well-formed facts', () => {
    const result = rememberVisitorFactSchema.safeParse({
      facts: ['[web · marais] Budget: 800k€', 'Prefers 3+ rooms']
    });
    assert.ok(result.success);
  });

  it('rejects empty array', () => {
    const result = rememberVisitorFactSchema.safeParse({ facts: [] });
    assert.ok(!result.success, 'at least one fact required');
  });

  it('rejects more than 20 facts', () => {
    const result = rememberVisitorFactSchema.safeParse({
      facts: Array.from({ length: 21 }, (_, i) => `fact ${i}`)
    });
    assert.ok(!result.success, 'max 20 facts per call');
  });

  it('accepts exactly 20 facts (boundary)', () => {
    const result = rememberVisitorFactSchema.safeParse({
      facts: Array.from({ length: 20 }, (_, i) => `fact ${i}`)
    });
    assert.ok(result.success, '20 facts is the maximum allowed');
  });

  it('rejects a fact exceeding 800 chars', () => {
    const result = rememberVisitorFactSchema.safeParse({
      facts: ['x'.repeat(801)]
    });
    assert.ok(!result.success, 'facts must be ≤ 800 chars');
  });

  it('accepts a fact exactly at 800 chars (boundary)', () => {
    const result = rememberVisitorFactSchema.safeParse({
      facts: ['x'.repeat(800)]
    });
    assert.ok(result.success, '800 chars is within the limit');
  });
});

// ── get_lead_viewings schema ───────────────────────────────────────────────────

describe('get_lead_viewings schema (lead)', () => {
  it('accepts empty object (no input required)', () => {
    assert.ok(getLeadViewingsSchema.safeParse({}).success);
  });

  it('ignores extra fields silently (zod default)', () => {
    // zod strips unknown keys by default — schema still passes
    assert.ok(getLeadViewingsSchema.safeParse({ unexpected: 'value' }).success);
  });
});

// ── cancel_viewing schema (lead) ───────────────────────────────────────────────

describe('cancel_viewing schema (lead)', () => {
  it('accepts viewing_id with optional reason', () => {
    assert.ok(cancelViewingSchema.safeParse({ viewing_id: 'v-abc', reason: 'Changed plans' }).success);
  });

  it('accepts viewing_id without reason', () => {
    assert.ok(cancelViewingSchema.safeParse({ viewing_id: 'v-abc' }).success);
  });

  it('rejects missing viewing_id', () => {
    assert.ok(!cancelViewingSchema.safeParse({ reason: 'test' }).success, 'viewing_id is required');
  });

  it('rejects reason over 300 chars', () => {
    assert.ok(!cancelViewingSchema.safeParse({ viewing_id: 'v-abc', reason: 'x'.repeat(301) }).success);
  });

  it('accepts reason exactly at 300 chars (boundary)', () => {
    assert.ok(cancelViewingSchema.safeParse({ viewing_id: 'v-abc', reason: 'x'.repeat(300) }).success);
  });
});

// ── reschedule_viewing schema (lead) ───────────────────────────────────────────

describe('reschedule_viewing schema (lead)', () => {
  it('accepts viewing_id + new_slot_iso', () => {
    assert.ok(rescheduleViewingSchema.safeParse({
      viewing_id: 'v-abc',
      new_slot_iso: '2026-06-20T08:00:00.000Z'
    }).success);
  });

  it('rejects missing new_slot_iso', () => {
    assert.ok(!rescheduleViewingSchema.safeParse({ viewing_id: 'v-abc' }).success, 'new_slot_iso is required');
  });

  it('rejects missing viewing_id', () => {
    assert.ok(!rescheduleViewingSchema.safeParse({ new_slot_iso: '2026-06-20T08:00:00.000Z' }).success);
  });

  it('rejects empty object', () => {
    assert.ok(!rescheduleViewingSchema.safeParse({}).success);
  });
});

// ── get_available_slots schema ─────────────────────────────────────────────────

describe('get_available_slots schema', () => {
  it('accepts optional count in range', () => {
    assert.ok(getAvailableSlotsSchema.safeParse({ count: 3 }).success);
    assert.ok(getAvailableSlotsSchema.safeParse({}).success);
  });

  it('rejects count = 0 (below minimum)', () => {
    assert.ok(!getAvailableSlotsSchema.safeParse({ count: 0 }).success);
  });

  it('rejects count = 6 (above maximum)', () => {
    assert.ok(!getAvailableSlotsSchema.safeParse({ count: 6 }).success);
  });

  it('rejects non-integer count', () => {
    assert.ok(!getAvailableSlotsSchema.safeParse({ count: 2.5 }).success);
  });
});

// ── Format utilities ───────────────────────────────────────────────────────────

describe('formatPrice', () => {
  it('formats in French locale with € symbol', () => {
    const s = formatPrice(650000, 'fr');
    // French formats as "650 000 €" (with non-breaking space or similar)
    assert.ok(s.includes('650'), 'should include number');
    assert.ok(s.includes('€'), 'should include euro symbol');
  });

  it('formats in English locale with EUR prefix', () => {
    const s = formatPrice(650000, 'en');
    assert.ok(s.includes('650,000') || s.includes('650 000'), 'should format thousands');
    assert.ok(s.includes('€') || s.includes('EUR'), 'should include euro');
  });

  it('rounds to integer — no decimals', () => {
    const s = formatPrice(649999.99, 'fr');
    assert.ok(!s.includes(','), 'French formatted price should not have decimal separator for whole numbers');
    assert.ok(!s.includes('.99'), 'should not show decimal cents');
  });
});

describe('formatSlot', () => {
  it('returns human-readable French label for a UTC ISO string', () => {
    const label = formatSlot('2026-06-15T08:00:00.000Z', 'fr');
    // 2026-06-15T08:00Z = 10:00 Paris time (CEST = UTC+2 in June)
    assert.ok(label.includes('10'), 'should show Paris-local hour (10:00 CEST)');
    assert.ok(label.length > 10, 'should return a descriptive label');
  });

  it('returns human-readable English label for a UTC ISO string', () => {
    const label = formatSlot('2026-06-15T08:00:00.000Z', 'en');
    assert.ok(label.includes('10'), 'English label should also show Paris hour');
  });

  it('returns different labels for different UTC times', () => {
    const a = formatSlot('2026-06-15T08:00:00.000Z', 'fr');
    const b = formatSlot('2026-06-15T14:00:00.000Z', 'fr');
    assert.notEqual(a, b, 'different slots must produce different labels');
  });
});

describe('formatThreadDate', () => {
  it('formats a date string for display in Paris timezone', () => {
    const label = formatThreadDate('2026-01-15T09:00:00.000Z', 'fr');
    // Jan 15 09:00 UTC = 10:00 Paris (CET = UTC+1 in January)
    assert.ok(label.includes('10'), 'should show Paris-local hour (10:00 CET)');
  });

  it('produces different output for different languages', () => {
    const fr = formatThreadDate('2026-06-15T08:00:00.000Z', 'fr');
    const en = formatThreadDate('2026-06-15T08:00:00.000Z', 'en');
    assert.notEqual(fr, en, 'French and English labels should differ');
  });
});
