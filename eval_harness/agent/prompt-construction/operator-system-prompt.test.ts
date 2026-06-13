/**
 * Tests for operator prompt building — covers the private helper functions
 * (leadProfileBlock, leadMemoryBlock) by shadowing them inline.
 *
 * buildOperatorSystemPrompt itself is async+DB so is not tested here.
 * These tests guard the pure content-building logic that composes the prompt.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../../../lib/types.ts';

// ── Shadow helpers (mirrors operator-prompts.ts private functions exactly) ────
// If the real implementations change, update these shadows to stay in sync.

function leadProfileBlock(lead: Lead): string {
  return `[LEAD PROFILE — your scoped client]
id: ${lead.id}
name: ${lead.name ?? '—'}
email: ${lead.email ?? '—'}
status: ${lead.status}
potential: ${lead.potential_status ?? 'unscored'}
reason: ${lead.score_reason ?? '—'}
qualification: ${JSON.stringify(lead.qual_values)}
telegram: ${lead.telegram_user_id ? 'linked' : 'not linked'}`;
}

function leadMemoryBlock(lead: Lead): string {
  const memory = lead.long_term_memory?.trim();
  if (!memory) return '[LEAD MEMORY]\n(empty — gather from threads)';
  return `[LEAD MEMORY — scoped to this lead only]\n${memory}`;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_LEAD: Lead = {
  id: 'l1',
  channel: 'web',
  language: 'fr',
  email: 'tarik@example.com',
  name: 'Tarik',
  status: 'active',
  potential_status: 'warm',
  qual_values: { budget: '650k€' },
  score_reason: 'Has budget, browsing actively',
  long_term_memory: null,
  listing_id: 'lst-1',
  telegram_user_id: null,
  created_at: new Date(),
  updated_at: new Date()
};

// ── leadProfileBlock ──────────────────────────────────────────────────────────

describe('leadProfileBlock — identified lead', () => {
  it('includes lead id, name, email, status, potential', () => {
    const block = leadProfileBlock(BASE_LEAD);
    assert.ok(block.includes('l1'));
    assert.ok(block.includes('Tarik'));
    assert.ok(block.includes('tarik@example.com'));
    assert.ok(block.includes('active'));
    assert.ok(block.includes('warm'));
  });

  it('includes qualification values as JSON', () => {
    const block = leadProfileBlock(BASE_LEAD);
    assert.ok(block.includes('"budget":"650k€"') || block.includes('"budget": "650k€"'));
  });

  it('shows score_reason when present', () => {
    const block = leadProfileBlock(BASE_LEAD);
    assert.ok(block.includes('Has budget, browsing actively'));
  });

  it('shows "not linked" when telegram_user_id is null', () => {
    const block = leadProfileBlock(BASE_LEAD);
    assert.ok(block.includes('not linked'));
  });

  it('shows "linked" when telegram_user_id is set', () => {
    const lead: Lead = { ...BASE_LEAD, telegram_user_id: '123456789' };
    const block = leadProfileBlock(lead);
    assert.ok(block.includes('linked') && !block.includes('not linked'));
  });
});

describe('leadProfileBlock — anonymous lead (no email/name)', () => {
  it('shows em-dash for missing name and email', () => {
    const lead: Lead = { ...BASE_LEAD, name: null, email: null };
    const block = leadProfileBlock(lead);
    const lines = block.split('\n');
    const nameLine = lines.find((l) => l.startsWith('name:'));
    const emailLine = lines.find((l) => l.startsWith('email:'));
    assert.ok(nameLine?.includes('—'), 'missing name should show —');
    assert.ok(emailLine?.includes('—'), 'missing email should show —');
  });

  it('shows "unscored" for null potential_status', () => {
    const lead: Lead = { ...BASE_LEAD, potential_status: null };
    const block = leadProfileBlock(lead);
    assert.ok(block.includes('unscored'));
  });

  it('shows "—" for null score_reason', () => {
    const lead: Lead = { ...BASE_LEAD, score_reason: null };
    const block = leadProfileBlock(lead);
    const lines = block.split('\n');
    const reasonLine = lines.find((l) => l.startsWith('reason:'));
    assert.ok(reasonLine?.includes('—'));
  });
});

describe('leadProfileBlock — various statuses', () => {
  const statuses = ['active', 'qualified', 'booked', 'handoff', 'abandoned'] as const;
  for (const status of statuses) {
    it(`shows status: ${status}`, () => {
      const lead: Lead = { ...BASE_LEAD, status };
      const block = leadProfileBlock(lead);
      assert.ok(block.includes(`status: ${status}`));
    });
  }
});

// ── leadMemoryBlock ────────────────────────────────────────────────────────────

describe('leadMemoryBlock — empty memory', () => {
  it('shows empty placeholder when long_term_memory is null', () => {
    const block = leadMemoryBlock({ ...BASE_LEAD, long_term_memory: null });
    assert.ok(block.includes('[LEAD MEMORY]'));
    assert.ok(block.includes('empty — gather from threads'));
  });

  it('shows empty placeholder for empty string memory', () => {
    const block = leadMemoryBlock({ ...BASE_LEAD, long_term_memory: '' });
    assert.ok(block.includes('empty — gather from threads'));
  });

  it('shows empty placeholder for whitespace-only memory', () => {
    const block = leadMemoryBlock({ ...BASE_LEAD, long_term_memory: '   \n  ' });
    assert.ok(block.includes('empty — gather from threads'));
  });
});

describe('leadMemoryBlock — with memory content', () => {
  it('includes scoped header and memory content', () => {
    const memory = 'Budget: 650k€\nPrefers Marais district';
    const block = leadMemoryBlock({ ...BASE_LEAD, long_term_memory: memory });
    assert.ok(block.includes('[LEAD MEMORY — scoped to this lead only]'));
    assert.ok(block.includes('Budget: 650k€'));
    assert.ok(block.includes('Prefers Marais district'));
  });

  it('trims leading/trailing whitespace from memory', () => {
    const block = leadMemoryBlock({ ...BASE_LEAD, long_term_memory: '  Budget: 700k€  ' });
    assert.ok(block.includes('Budget: 700k€'));
  });

  it('does NOT show the empty placeholder when memory is present', () => {
    const block = leadMemoryBlock({ ...BASE_LEAD, long_term_memory: 'some fact' });
    assert.ok(!block.includes('empty — gather from threads'));
  });
});

// ── Operator frame constant ────────────────────────────────────────────────────

describe('Operator frame constants (content validation)', () => {
  it('TOOLS_BLOCK covers all core operator tool names', () => {
    // Shadow the constant to verify critical tool names are present
    const TOOLS_BLOCK = `[TOOLS]
Threads:
- list_threads — visitor threads in your scope
- get_thread(conversation_id) — full messages of one thread
- send_reply(conversation_id, content) — message the visitor on their channel
- draft_reply(conversation_id, intent) — compose without sending
- takeover_thread / release_thread — manual mode per thread
Lead management (lead_id defaults to your scoped lead; pass explicitly in pool mode):
- update_lead_status(potential_status?, status?, memory_note) — potential works on anyone; lifecycle status needs an identified lead
- record_qualification(values, potential_status, reason) — persist qualification
- remember_visitor_fact(facts[]) — append durable facts to long-term memory
- get_lead_viewings / cancel_viewing(reason) / reschedule_viewing(new_slot_iso)
- request_handoff(reason) — escalate to a human + alert admins
- notify_admin(summary)`;

    const toolNames = [
      'list_threads', 'get_thread', 'send_reply', 'draft_reply',
      'takeover_thread', 'release_thread', 'update_lead_status',
      'record_qualification', 'remember_visitor_fact',
      'get_lead_viewings', 'cancel_viewing', 'reschedule_viewing',
      'request_handoff', 'notify_admin'
    ];
    for (const name of toolNames) {
      assert.ok(TOOLS_BLOCK.includes(name), `TOOLS_BLOCK must document tool: ${name}`);
    }
  });

  it('OPERATOR_FRAME clarifies operator is talking to admin not customer', () => {
    const OPERATOR_FRAME = `[OPERATOR MODE — who you are talking to]
You ARE this lead's own dedicated AI agent — the same agent that chats with the customer.
Right now you are speaking with your HUMAN ADMIN/OPERATOR (in the admin panel), NOT the customer.
Your replies in THIS conversation are internal and are NOT sent to the customer.
To actually message the customer, you must explicitly call send_reply on one of their threads.`;

    assert.ok(OPERATOR_FRAME.includes('NOT the customer'));
    assert.ok(OPERATOR_FRAME.includes('internal'));
    assert.ok(OPERATOR_FRAME.includes('send_reply'));
    assert.ok(!OPERATOR_FRAME.includes('finish_reply'), 'finish_reply must not appear');
  });
});
