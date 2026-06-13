/**
 * Schema validation tests for operator agent tools.
 * Shadow schemas mirror operator-lead-actions.ts + operator-thread-tools.ts exactly.
 * No DB, no LLM — pure zod validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// ── Shadow schemas — operator-lead-actions.ts ─────────────────────────────────

const updateLeadStatusSchema = z.object({
  lead_id: z.string().optional(),
  potential_status: z.enum(['hot', 'warm', 'cold']).optional(),
  status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
  memory_note: z.string().max(600).optional()
});

const operatorRecordQualificationSchema = z.object({
  lead_id: z.string().optional(),
  values: z.record(z.string(), z.string()),
  potential_status: z.enum(['hot', 'warm', 'cold']),
  reason: z.string().max(200)
});

const operatorRememberVisitorFactSchema = z.object({
  lead_id: z.string().optional(),
  facts: z.array(z.string().max(500)).min(1).max(10)
});

const cancelViewingSchema = z.object({
  viewing_id: z.string(),
  reason: z.string().max(400).optional()
});

const rescheduleViewingSchema = z.object({
  viewing_id: z.string(),
  new_slot_iso: z.string()
});

const requestHandoffSchema = z.object({
  reason: z.string().min(1).max(600),
  lead_id: z.string().optional()
});

const notifyAdminSchema = z.object({
  summary: z.string().max(280)
});

// ── Shadow schemas — operator-thread-tools.ts ─────────────────────────────────

const listThreadsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional()
});

const getThreadSchema = z.object({
  conversation_id: z.string().uuid()
});

const draftReplySchema = z.object({
  conversation_id: z.string().uuid(),
  intent: z.string().max(400)
});

const sendReplyOperatorSchema = z.object({
  conversation_id: z.string().uuid(),
  content: z.string().min(1)
});

const takeoverThreadSchema = z.object({
  conversation_id: z.string().uuid()
});

const releaseThreadSchema = z.object({
  conversation_id: z.string().uuid()
});

// Valid UUID v4: third group starts with 4, fourth group starts with a/b/8/9
const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

// ── update_lead_status ────────────────────────────────────────────────────────

describe('update_lead_status (operator)', () => {
  it('accepts all fields present', () => {
    assert.ok(updateLeadStatusSchema.safeParse({
      lead_id: 'l1',
      potential_status: 'hot',
      status: 'qualified',
      memory_note: 'Confirmed budget and timeline'
    }).success);
  });

  it('accepts empty object (all fields optional in operator mode)', () => {
    assert.ok(updateLeadStatusSchema.safeParse({}).success);
  });

  it('rejects unknown potential_status', () => {
    assert.ok(!updateLeadStatusSchema.safeParse({ potential_status: 'lukewarm' }).success);
  });

  it('rejects unknown lifecycle status', () => {
    assert.ok(!updateLeadStatusSchema.safeParse({ status: 'rejected' }).success);
  });

  it('rejects memory_note over 600 chars', () => {
    assert.ok(!updateLeadStatusSchema.safeParse({ memory_note: 'x'.repeat(601) }).success);
  });

  it('accepts memory_note exactly at 600 chars', () => {
    assert.ok(updateLeadStatusSchema.safeParse({ memory_note: 'x'.repeat(600) }).success);
  });
});

// ── record_qualification (operator) ───────────────────────────────────────────

describe('record_qualification (operator)', () => {
  it('accepts with explicit lead_id (pool mode)', () => {
    assert.ok(operatorRecordQualificationSchema.safeParse({
      lead_id: 'l1',
      values: { budget: '700k€' },
      potential_status: 'hot',
      reason: 'High intent'
    }).success);
  });

  it('accepts without lead_id (scoped mode)', () => {
    assert.ok(operatorRecordQualificationSchema.safeParse({
      values: { budget: '700k€' },
      potential_status: 'warm',
      reason: 'Moderate intent'
    }).success);
  });

  it('rejects reason over 200 chars', () => {
    assert.ok(!operatorRecordQualificationSchema.safeParse({
      values: {},
      potential_status: 'cold',
      reason: 'x'.repeat(201)
    }).success);
  });
});

// ── remember_visitor_fact (operator) ──────────────────────────────────────────

describe('remember_visitor_fact (operator)', () => {
  it('accepts facts with optional lead_id', () => {
    assert.ok(operatorRememberVisitorFactSchema.safeParse({
      lead_id: 'l1',
      facts: ['Budget: 650k€']
    }).success);
  });

  it('rejects empty facts array', () => {
    assert.ok(!operatorRememberVisitorFactSchema.safeParse({ facts: [] }).success);
  });

  it('rejects more than 10 facts', () => {
    assert.ok(!operatorRememberVisitorFactSchema.safeParse({
      facts: Array.from({ length: 11 }, (_, i) => `fact ${i}`)
    }).success);
  });
});

// ── cancel_viewing ────────────────────────────────────────────────────────────

describe('cancel_viewing (operator)', () => {
  it('accepts viewing_id with optional reason', () => {
    assert.ok(cancelViewingSchema.safeParse({ viewing_id: 'v1', reason: 'Lead cancelled' }).success);
    assert.ok(cancelViewingSchema.safeParse({ viewing_id: 'v1' }).success);
  });

  it('rejects missing viewing_id', () => {
    assert.ok(!cancelViewingSchema.safeParse({ reason: 'test' }).success);
  });

  it('rejects reason over 400 chars', () => {
    assert.ok(!cancelViewingSchema.safeParse({ viewing_id: 'v1', reason: 'x'.repeat(401) }).success);
  });
});

// ── reschedule_viewing ────────────────────────────────────────────────────────

describe('reschedule_viewing (operator)', () => {
  it('accepts viewing_id + new_slot_iso', () => {
    assert.ok(rescheduleViewingSchema.safeParse({
      viewing_id: 'v1',
      new_slot_iso: '2026-06-20T08:00:00.000Z'
    }).success);
  });

  it('rejects missing new_slot_iso', () => {
    assert.ok(!rescheduleViewingSchema.safeParse({ viewing_id: 'v1' }).success);
  });
});

// ── request_handoff ───────────────────────────────────────────────────────────

describe('request_handoff (operator)', () => {
  it('accepts reason with optional lead_id', () => {
    assert.ok(requestHandoffSchema.safeParse({ reason: 'Legal question about fees' }).success);
    assert.ok(requestHandoffSchema.safeParse({ reason: 'Legal question', lead_id: 'l1' }).success);
  });

  it('rejects empty reason', () => {
    assert.ok(!requestHandoffSchema.safeParse({ reason: '' }).success);
  });

  it('rejects reason over 600 chars', () => {
    assert.ok(!requestHandoffSchema.safeParse({ reason: 'x'.repeat(601) }).success);
  });
});

// ── notify_admin ──────────────────────────────────────────────────────────────

describe('notify_admin (operator)', () => {
  it('accepts summary within limit', () => {
    assert.ok(notifyAdminSchema.safeParse({ summary: 'Lead showed high interest' }).success);
  });

  it('rejects summary over 280 chars', () => {
    assert.ok(!notifyAdminSchema.safeParse({ summary: 'x'.repeat(281) }).success);
  });

  it('accepts summary exactly at 280 chars', () => {
    assert.ok(notifyAdminSchema.safeParse({ summary: 'x'.repeat(280) }).success);
  });
});

// ── list_threads ──────────────────────────────────────────────────────────────

describe('list_threads (operator thread tool)', () => {
  it('accepts optional limit in range', () => {
    assert.ok(listThreadsSchema.safeParse({ limit: 10 }).success);
    assert.ok(listThreadsSchema.safeParse({}).success);
  });

  it('rejects limit = 0', () => {
    assert.ok(!listThreadsSchema.safeParse({ limit: 0 }).success);
  });

  it('rejects limit > 50', () => {
    assert.ok(!listThreadsSchema.safeParse({ limit: 51 }).success);
  });

  it('rejects non-integer limit', () => {
    assert.ok(!listThreadsSchema.safeParse({ limit: 5.5 }).success);
  });
});

// ── get_thread ────────────────────────────────────────────────────────────────

describe('get_thread (operator thread tool)', () => {
  it('accepts valid UUID', () => {
    assert.ok(getThreadSchema.safeParse({ conversation_id: '123e4567-e89b-42d3-a456-426614174000' }).success);
  });

  it('rejects non-UUID string', () => {
    assert.ok(!getThreadSchema.safeParse({ conversation_id: 'not-a-uuid' }).success);
  });

  it('rejects missing conversation_id', () => {
    assert.ok(!getThreadSchema.safeParse({}).success);
  });
});

// ── draft_reply ───────────────────────────────────────────────────────────────

describe('draft_reply (operator thread tool)', () => {
  it('accepts valid UUID + intent', () => {
    assert.ok(draftReplySchema.safeParse({
      conversation_id: '123e4567-e89b-42d3-a456-426614174000',
      intent: 'Confirm the viewing slot and ask for contact details'
    }).success);
  });

  it('rejects intent over 400 chars', () => {
    assert.ok(!draftReplySchema.safeParse({
      conversation_id: '123e4567-e89b-42d3-a456-426614174000',
      intent: 'x'.repeat(401)
    }).success);
  });

  it('rejects non-UUID conversation_id', () => {
    assert.ok(!draftReplySchema.safeParse({
      conversation_id: 'bad-id',
      intent: 'test'
    }).success);
  });
});

// ── send_reply (operator) ─────────────────────────────────────────────────────

describe('send_reply (operator thread tool)', () => {
  it('accepts valid UUID + non-empty content', () => {
    assert.ok(sendReplyOperatorSchema.safeParse({
      conversation_id: '123e4567-e89b-42d3-a456-426614174000',
      content: 'Bonjour, voici les créneaux disponibles…'
    }).success);
  });

  it('rejects empty content', () => {
    assert.ok(!sendReplyOperatorSchema.safeParse({
      conversation_id: '123e4567-e89b-42d3-a456-426614174000',
      content: ''
    }).success);
  });
});

// ── takeover_thread / release_thread ──────────────────────────────────────────

describe('takeover_thread / release_thread (operator thread tools)', () => {
  it('takeover_thread accepts valid UUID', () => {
    assert.ok(takeoverThreadSchema.safeParse({ conversation_id: '123e4567-e89b-42d3-a456-426614174000' }).success);
  });

  it('release_thread accepts valid UUID', () => {
    assert.ok(releaseThreadSchema.safeParse({ conversation_id: '123e4567-e89b-42d3-a456-426614174000' }).success);
  });

  it('both reject non-UUID conversation_id', () => {
    assert.ok(!takeoverThreadSchema.safeParse({ conversation_id: 'bad' }).success);
    assert.ok(!releaseThreadSchema.safeParse({ conversation_id: 'bad' }).success);
  });
});
