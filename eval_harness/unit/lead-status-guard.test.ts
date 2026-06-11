/**
 * Unit tests for lead status guard in record_qualification (BUG-001 fix).
 * Verifies that booking/handoff/abandoned leads are never downgraded to 'qualified'.
 * Logic inlined from lib/agent/tools/lead-tools.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

type LeadStatus = 'active' | 'qualified' | 'booked' | 'handoff' | 'abandoned';

/** Mirrors the fixed status logic in record_qualification execute() */
function resolveStatus(
  currentStatus: LeadStatus,
  allCriteriaComplete: boolean
): LeadStatus {
  // Only promote to 'qualified' when coming from 'active'.
  // Never overwrite booked, handoff, or abandoned.
  return allCriteriaComplete && currentStatus === 'active' ? 'qualified' : currentStatus;
}

describe('record_qualification status guard', () => {
  it('promotes active → qualified when all criteria met', () => {
    assert.equal(resolveStatus('active', true), 'qualified');
  });

  it('keeps active when criteria incomplete', () => {
    assert.equal(resolveStatus('active', false), 'active');
  });

  it('never downgrades booked → qualified even with full criteria', () => {
    assert.equal(resolveStatus('booked', true), 'booked');
  });

  it('never downgrades handoff → qualified', () => {
    assert.equal(resolveStatus('handoff', true), 'handoff');
  });

  it('never downgrades abandoned → qualified', () => {
    assert.equal(resolveStatus('abandoned', true), 'abandoned');
  });

  it('keeps qualified when criteria now incomplete (re-call edge case)', () => {
    // If criteria temporarily incomplete (criteria config changed), don't regress
    assert.equal(resolveStatus('qualified', false), 'qualified');
  });
});

describe('isIdentifiedLead logic', () => {
  function isIdentifiedLead(lead: { email?: string | null; name?: string | null }): boolean {
    return Boolean(lead.email?.trim() || lead.name?.trim());
  }

  it('identified when email is present', () => {
    assert.equal(isIdentifiedLead({ email: 'user@example.com' }), true);
  });

  it('identified when only name is present', () => {
    assert.equal(isIdentifiedLead({ name: 'Tarik' }), true);
  });

  it('not identified when both are null', () => {
    assert.equal(isIdentifiedLead({ email: null, name: null }), false);
  });

  it('not identified when both are empty strings', () => {
    assert.equal(isIdentifiedLead({ email: '', name: '' }), false);
  });

  it('not identified when whitespace-only', () => {
    assert.equal(isIdentifiedLead({ email: '   ', name: '  ' }), false);
  });
});
