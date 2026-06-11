/**
 * Unit tests for conversation access control logic.
 * Verifies the anonymous→identified lock-out rule and the 403/404 decision tree.
 * Logic inlined from lib/conversation-access.ts and lib/leads/is-identified-lead.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline types and logic under test ────────────────────────────────────────

type Lead = { id: string; email?: string | null; name?: string | null };
type Conv = { id: string; type: string; lead_id: string | null };

function isIdentifiedLead(lead: Lead): boolean {
  return Boolean(lead.email?.trim() || lead.name?.trim());
}

type AccessResult = { allowed: boolean; status?: 403 | 404 };

/**
 * Pure decision logic extracted from assertLeadChatAccess.
 * Returns { allowed: true } or { allowed: false, status }.
 */
function checkAccess(
  conv: Conv | null,
  sessionLeadId: string | null,
  convLead: Lead | null
): AccessResult {
  if (!conv || conv.type !== 'lead') return { allowed: false, status: 404 };
  if (!conv.lead_id) return { allowed: true };                 // anonymous conv
  if (conv.lead_id === sessionLeadId) return { allowed: true }; // owner
  // conv has a lead that doesn't match session — allow until identified
  if (!convLead || !isIdentifiedLead(convLead)) return { allowed: true };
  return { allowed: false, status: 403 };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const anonConv  = (id = 'c1'): Conv => ({ id, type: 'lead', lead_id: null });
const ownedConv = (leadId: string, id = 'c2'): Conv => ({ id, type: 'lead', lead_id: leadId });
const anonLead  = (id = 'l1'): Lead => ({ id, email: null, name: null });
const namedLead = (id = 'l1'): Lead => ({ id, email: 'user@ex.com', name: 'Tarik' });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('checkAccess — 404 cases', () => {
  it('returns 404 when conversation not found', () => {
    const r = checkAccess(null, null, null);
    assert.deepEqual(r, { allowed: false, status: 404 });
  });

  it('returns 404 for non-lead conversation type', () => {
    const r = checkAccess({ id: 'c1', type: 'main_assistant', lead_id: null }, null, null);
    assert.deepEqual(r, { allowed: false, status: 404 });
  });
});

describe('checkAccess — anonymous conversation (no lead_id)', () => {
  it('allows any session (anonymous visitor) to access', () => {
    const r = checkAccess(anonConv(), null, null);
    assert.deepEqual(r, { allowed: true });
  });

  it('allows identified session to access anonymous conv', () => {
    const r = checkAccess(anonConv(), 'l1', null);
    assert.deepEqual(r, { allowed: true });
  });
});

describe('checkAccess — conv owned by a lead', () => {
  it('allows matching session', () => {
    const r = checkAccess(ownedConv('l1'), 'l1', namedLead('l1'));
    assert.deepEqual(r, { allowed: true });
  });

  it('allows non-matching session while lead is still anonymous (no email/name)', () => {
    // ensureLead creates a lead before email is captured — must not lock out visitor yet
    const r = checkAccess(ownedConv('l1'), null, anonLead('l1'));
    assert.deepEqual(r, { allowed: true });
  });

  it('allows non-matching session while lead has no identity info', () => {
    const r = checkAccess(ownedConv('l1'), 'other', anonLead('l1'));
    assert.deepEqual(r, { allowed: true });
  });

  it('returns 403 when lead is identified and session does not match', () => {
    // After booking: lead has email → lock out mismatched sessions
    const r = checkAccess(ownedConv('l1'), null, namedLead('l1'));
    assert.deepEqual(r, { allowed: false, status: 403 });
  });

  it('returns 403 when named lead accessed by different session', () => {
    const r = checkAccess(ownedConv('l1'), 'other-lead', namedLead('l1'));
    assert.deepEqual(r, { allowed: false, status: 403 });
  });

  it('allows when lead is identified but session matches (cookie set correctly)', () => {
    const r = checkAccess(ownedConv('l1'), 'l1', namedLead('l1'));
    assert.deepEqual(r, { allowed: true });
  });
});

describe('checkAccess — lead with name-only (no email)', () => {
  it('locks out on name even without email', () => {
    const nameOnlyLead: Lead = { id: 'l1', email: null, name: 'Pierre' };
    const r = checkAccess(ownedConv('l1'), null, nameOnlyLead);
    assert.deepEqual(r, { allowed: false, status: 403 });
  });
});
