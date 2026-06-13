/**
 * Schema validation tests for main_assistant agent tools.
 * Shadow schemas mirror main-assistant-tools.ts exactly.
 * No DB, no LLM — pure zod validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { criterionSchema } from '../../../lib/types.ts';

// ── Shadow schemas ─────────────────────────────────────────────────────────────

const queryLeadsSchema = z.object({
  status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
  potential: z.enum(['hot', 'warm', 'cold']).optional(),
  listing_id: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional()
});

const searchLeadsSchema = z.object({
  query: z.string().min(1).max(200)
});

const searchMessagesSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(30).optional()
});

const getLeadThreadsSchema = z.object({ lead_id: z.string() });

const updateLeadInfoSchema = z.object({
  lead_id: z.string(),
  name: z.string().max(255).optional(),
  email: z.string().email().optional(),
  status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
  potential_status: z.enum(['hot', 'warm', 'cold']).optional(),
  memory_note: z.string().max(600).optional()
});

const getLeadDetailSchema = z.object({ lead_id: z.string() });
const getLeadViewingsSchema = z.object({ lead_id: z.string() });

const sendReplyMainSchema = z.object({
  lead_id: z.string(),
  content: z.string().min(1)
});

const draftReplyMainSchema = z.object({
  lead_id: z.string(),
  question: z.string().max(400).optional()
});

const takeoverConversationSchema = z.object({ lead_id: z.string() });
const releaseConversationSchema = z.object({ lead_id: z.string() });

const triggerOperatorBriefingSchema = z.object({
  lead_id: z.string(),
  question: z.string().max(400).optional()
});

const triggerLeadTurnSchema = z.object({
  conversation_id: z.string(),
  message: z.string().min(1).max(1000)
});

const bulkFollowUpSchema = z.object({
  message: z.string().min(1).max(1000),
  potential: z.enum(['hot', 'warm']).optional(),
  inactive_days: z.number().int().min(1).max(90).default(7)
});

const telegramBroadcastSchema = z.object({
  message: z.string().min(1).max(1000),
  potential: z.enum(['hot', 'warm', 'cold']).optional(),
  listing_id: z.string().optional()
});

const createHandoffRuleSchema = z.object({
  description: z.string().min(1).max(255),
  trigger_keywords: z.array(z.string().min(1)).min(1)
});

const toggleHandoffRuleSchema = z.object({
  rule_id: z.string(),
  active: z.boolean()
});

const deleteHandoffRuleSchema = z.object({ rule_id: z.string() });

const updateCriteriaSchema = z.object({
  criteria: z.array(criterionSchema).min(1)
});

const updateConfigSchema = z.object({
  name: z.string().max(255).optional(),
  tone: z.string().max(1000).optional()
});

const mainNotifyAdminSchema = z.object({ summary: z.string().max(280) });

// ── query_leads ───────────────────────────────────────────────────────────────

describe('query_leads', () => {
  it('accepts all filters combined', () => {
    assert.ok(queryLeadsSchema.safeParse({
      status: 'active', potential: 'hot', listing_id: 'lst-1', limit: 10
    }).success);
  });

  it('accepts empty object (no filters = all leads)', () => {
    assert.ok(queryLeadsSchema.safeParse({}).success);
  });

  it('rejects unknown status', () => {
    assert.ok(!queryLeadsSchema.safeParse({ status: 'pending' }).success);
  });

  it('rejects limit = 0', () => {
    assert.ok(!queryLeadsSchema.safeParse({ limit: 0 }).success);
  });

  it('rejects limit > 50', () => {
    assert.ok(!queryLeadsSchema.safeParse({ limit: 51 }).success);
  });
});

// ── search_leads ──────────────────────────────────────────────────────────────

describe('search_leads', () => {
  it('accepts a valid search query', () => {
    assert.ok(searchLeadsSchema.safeParse({ query: 'tarik' }).success);
  });

  it('rejects empty query', () => {
    assert.ok(!searchLeadsSchema.safeParse({ query: '' }).success);
  });

  it('rejects query over 200 chars', () => {
    assert.ok(!searchLeadsSchema.safeParse({ query: 'x'.repeat(201) }).success);
  });
});

// ── search_messages ───────────────────────────────────────────────────────────

describe('search_messages', () => {
  it('accepts query with optional limit', () => {
    assert.ok(searchMessagesSchema.safeParse({ query: 'budget', limit: 15 }).success);
    assert.ok(searchMessagesSchema.safeParse({ query: 'budget' }).success);
  });

  it('rejects limit > 30', () => {
    assert.ok(!searchMessagesSchema.safeParse({ query: 'test', limit: 31 }).success);
  });

  it('rejects empty query', () => {
    assert.ok(!searchMessagesSchema.safeParse({ query: '' }).success);
  });
});

// ── update_lead_info ──────────────────────────────────────────────────────────

describe('update_lead_info', () => {
  it('accepts lead_id only (no changes — still valid)', () => {
    assert.ok(updateLeadInfoSchema.safeParse({ lead_id: 'l1' }).success);
  });

  it('accepts full update with status + memory_note', () => {
    assert.ok(updateLeadInfoSchema.safeParse({
      lead_id: 'l1',
      status: 'abandoned',
      potential_status: 'cold',
      memory_note: 'Said they found another property'
    }).success);
  });

  it('rejects malformed email', () => {
    assert.ok(!updateLeadInfoSchema.safeParse({ lead_id: 'l1', email: 'not-email' }).success);
  });

  it('rejects name over 255 chars', () => {
    assert.ok(!updateLeadInfoSchema.safeParse({ lead_id: 'l1', name: 'x'.repeat(256) }).success);
  });

  it('rejects memory_note over 600 chars', () => {
    assert.ok(!updateLeadInfoSchema.safeParse({ lead_id: 'l1', memory_note: 'x'.repeat(601) }).success);
  });

  it('rejects unknown status value', () => {
    assert.ok(!updateLeadInfoSchema.safeParse({ lead_id: 'l1', status: 'rejected' }).success);
  });
});

// ── send_reply (main assistant) ───────────────────────────────────────────────

describe('send_reply (main assistant)', () => {
  it('accepts lead_id + non-empty content', () => {
    assert.ok(sendReplyMainSchema.safeParse({ lead_id: 'l1', content: 'Bonjour!' }).success);
  });

  it('rejects empty content', () => {
    assert.ok(!sendReplyMainSchema.safeParse({ lead_id: 'l1', content: '' }).success);
  });
});

// ── trigger_lead_turn ─────────────────────────────────────────────────────────

describe('trigger_lead_turn', () => {
  it('accepts conversation_id + message within bounds', () => {
    assert.ok(triggerLeadTurnSchema.safeParse({
      conversation_id: 'conv-1',
      message: 'Send a follow-up about the viewing'
    }).success);
  });

  it('rejects empty message', () => {
    assert.ok(!triggerLeadTurnSchema.safeParse({ conversation_id: 'conv-1', message: '' }).success);
  });

  it('rejects message over 1000 chars', () => {
    assert.ok(!triggerLeadTurnSchema.safeParse({
      conversation_id: 'conv-1',
      message: 'x'.repeat(1001)
    }).success);
  });
});

// ── bulk_follow_up ────────────────────────────────────────────────────────────

describe('bulk_follow_up', () => {
  it('accepts message with default inactive_days', () => {
    const result = bulkFollowUpSchema.safeParse({ message: 'Are you still interested?' });
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.inactive_days, 7);
  });

  it('accepts optional potential filter', () => {
    assert.ok(bulkFollowUpSchema.safeParse({
      message: 'Follow up',
      potential: 'hot',
      inactive_days: 3
    }).success);
  });

  it('rejects potential = "cold" (cold leads excluded from bulk follow-up)', () => {
    assert.ok(!bulkFollowUpSchema.safeParse({ message: 'test', potential: 'cold' }).success);
  });

  it('rejects inactive_days = 0', () => {
    assert.ok(!bulkFollowUpSchema.safeParse({ message: 'test', inactive_days: 0 }).success);
  });

  it('rejects inactive_days > 90', () => {
    assert.ok(!bulkFollowUpSchema.safeParse({ message: 'test', inactive_days: 91 }).success);
  });

  it('rejects empty message', () => {
    assert.ok(!bulkFollowUpSchema.safeParse({ message: '' }).success);
  });

  it('rejects message over 1000 chars', () => {
    assert.ok(!bulkFollowUpSchema.safeParse({ message: 'x'.repeat(1001) }).success);
  });
});

// ── telegram_broadcast ────────────────────────────────────────────────────────

describe('telegram_broadcast', () => {
  it('accepts message with optional filters', () => {
    assert.ok(telegramBroadcastSchema.safeParse({
      message: 'New viewing available this week!',
      potential: 'hot',
      listing_id: 'lst-1'
    }).success);
  });

  it('accepts message without filters (broadcast all telegram users)', () => {
    assert.ok(telegramBroadcastSchema.safeParse({ message: 'General update' }).success);
  });

  it('rejects message over 1000 chars', () => {
    assert.ok(!telegramBroadcastSchema.safeParse({ message: 'x'.repeat(1001) }).success);
  });

  it('rejects unknown potential value', () => {
    assert.ok(!telegramBroadcastSchema.safeParse({ message: 'test', potential: 'lukewarm' }).success);
  });
});

// ── create_handoff_rule ───────────────────────────────────────────────────────

describe('create_handoff_rule', () => {
  it('accepts description + non-empty keywords array', () => {
    assert.ok(createHandoffRuleSchema.safeParse({
      description: 'Escalate when visitor mentions legal issues',
      trigger_keywords: ['lawyer', 'legal', 'fees']
    }).success);
  });

  it('rejects empty keywords array', () => {
    assert.ok(!createHandoffRuleSchema.safeParse({
      description: 'Test rule',
      trigger_keywords: []
    }).success);
  });

  it('rejects empty description', () => {
    assert.ok(!createHandoffRuleSchema.safeParse({
      description: '',
      trigger_keywords: ['test']
    }).success);
  });

  it('rejects description over 255 chars', () => {
    assert.ok(!createHandoffRuleSchema.safeParse({
      description: 'x'.repeat(256),
      trigger_keywords: ['test']
    }).success);
  });

  it('rejects keywords array with empty string', () => {
    assert.ok(!createHandoffRuleSchema.safeParse({
      description: 'Test',
      trigger_keywords: ['valid', '']
    }).success);
  });
});

// ── toggle_handoff_rule ───────────────────────────────────────────────────────

describe('toggle_handoff_rule', () => {
  it('accepts rule_id + boolean active', () => {
    assert.ok(toggleHandoffRuleSchema.safeParse({ rule_id: 'r1', active: true }).success);
    assert.ok(toggleHandoffRuleSchema.safeParse({ rule_id: 'r1', active: false }).success);
  });

  it('rejects non-boolean active', () => {
    assert.ok(!toggleHandoffRuleSchema.safeParse({ rule_id: 'r1', active: 'yes' }).success);
    assert.ok(!toggleHandoffRuleSchema.safeParse({ rule_id: 'r1', active: 1 }).success);
  });

  it('rejects missing active field', () => {
    assert.ok(!toggleHandoffRuleSchema.safeParse({ rule_id: 'r1' }).success);
  });
});

// ── update_criteria ───────────────────────────────────────────────────────────

describe('update_criteria', () => {
  it('accepts valid criteria array', () => {
    assert.ok(updateCriteriaSchema.safeParse({
      criteria: [
        { key: 'budget', label: 'Budget', hint: 'max price in €' },
        { key: 'timeline', label: 'Timeline' }
      ]
    }).success);
  });

  it('rejects empty criteria array', () => {
    assert.ok(!updateCriteriaSchema.safeParse({ criteria: [] }).success);
  });

  it('rejects criterion key with uppercase letters', () => {
    assert.ok(!updateCriteriaSchema.safeParse({
      criteria: [{ key: 'Budget', label: 'Budget' }]
    }).success);
  });

  it('rejects criterion key with spaces', () => {
    assert.ok(!updateCriteriaSchema.safeParse({
      criteria: [{ key: 'my budget', label: 'Budget' }]
    }).success);
  });
});

// ── update_config ─────────────────────────────────────────────────────────────

describe('update_config', () => {
  it('accepts both name and tone', () => {
    assert.ok(updateConfigSchema.safeParse({ name: 'Agence Lumière', tone: 'Warm and professional.' }).success);
  });

  it('accepts empty object (no-op call)', () => {
    assert.ok(updateConfigSchema.safeParse({}).success);
  });

  it('rejects name over 255 chars', () => {
    assert.ok(!updateConfigSchema.safeParse({ name: 'x'.repeat(256) }).success);
  });

  it('rejects tone over 1000 chars', () => {
    assert.ok(!updateConfigSchema.safeParse({ tone: 'x'.repeat(1001) }).success);
  });
});

// ── notify_admin (main assistant) ─────────────────────────────────────────────

describe('notify_admin (main assistant)', () => {
  it('accepts summary within limit', () => {
    assert.ok(mainNotifyAdminSchema.safeParse({ summary: 'Lead Tarik booked viewing for Marais apt' }).success);
  });

  it('rejects summary over 280 chars', () => {
    assert.ok(!mainNotifyAdminSchema.safeParse({ summary: 'x'.repeat(281) }).success);
  });
});

// ── takeover / release conversation ──────────────────────────────────────────

describe('takeover_conversation / release_conversation', () => {
  it('takeover accepts lead_id', () => {
    assert.ok(takeoverConversationSchema.safeParse({ lead_id: 'l1' }).success);
  });

  it('release accepts lead_id', () => {
    assert.ok(releaseConversationSchema.safeParse({ lead_id: 'l1' }).success);
  });

  it('both reject missing lead_id', () => {
    assert.ok(!takeoverConversationSchema.safeParse({}).success);
    assert.ok(!releaseConversationSchema.safeParse({}).success);
  });
});
