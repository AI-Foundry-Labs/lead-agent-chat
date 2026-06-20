/**
 * Pure logic tests for viewing management: ownership guards, idempotency,
 * status restoration, and multi-tenant security.
 * No DB, no calendar — only the decision logic mirrored from:
 *   lead-tools.ts, main-assistant-tools.ts, lib/db/viewings.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Ownership guard — lead (conversation-scoped) ──────────────────────────────

type ViewingOwnershipLead = {
  id: string;
  conversation_id: string;
  agency_id: string;
  status: string;
};

function leadOwnershipCheck(
  viewing: ViewingOwnershipLead | null,
  callerConversationId: string
): 'ok' | 'viewing_not_found' {
  if (!viewing || viewing.conversation_id !== callerConversationId) {
    return 'viewing_not_found';
  }
  return 'ok';
}

describe('viewing ownership guard (lead — conversation-scoped)', () => {
  const viewing: ViewingOwnershipLead = {
    id: 'v-1',
    conversation_id: 'conv-A',
    agency_id: 'agency-1',
    status: 'booked'
  };

  it('allows cancel/reschedule when conversation_id matches', () => {
    assert.equal(leadOwnershipCheck(viewing, 'conv-A'), 'ok');
  });

  it('rejects when conversation_id does not match (cross-conversation attack)', () => {
    assert.equal(leadOwnershipCheck(viewing, 'conv-B'), 'viewing_not_found');
  });

  it('rejects null viewing (not found in DB)', () => {
    assert.equal(leadOwnershipCheck(null, 'conv-A'), 'viewing_not_found');
  });
});

// ── Ownership guard — admin (agency-scoped) ───────────────────────────────────

function adminOwnershipCheck(
  viewing: ViewingOwnershipLead | null,
  callerAgencyId: string
): 'ok' | 'viewing_not_found' {
  if (!viewing || viewing.agency_id !== callerAgencyId) {
    return 'viewing_not_found';
  }
  return 'ok';
}

describe('viewing ownership guard (admin — agency-scoped multi-tenant)', () => {
  const viewing: ViewingOwnershipLead = {
    id: 'v-2',
    conversation_id: 'conv-X',
    agency_id: 'agency-1',
    status: 'booked'
  };

  it('allows cancel/reschedule when agency_id matches', () => {
    assert.equal(adminOwnershipCheck(viewing, 'agency-1'), 'ok');
  });

  it('rejects when agency_id does not match (cross-tenant attack)', () => {
    assert.equal(adminOwnershipCheck(viewing, 'agency-2'), 'viewing_not_found');
  });

  it('rejects null viewing (not found in DB)', () => {
    assert.equal(adminOwnershipCheck(null, 'agency-1'), 'viewing_not_found');
  });

  it('same viewing_id can belong to different agencies — never leak across tenants', () => {
    // Simulates two agencies with coincidentally same viewing_id
    const agencyAViewing = { ...viewing, agency_id: 'agency-A' };
    assert.equal(adminOwnershipCheck(agencyAViewing, 'agency-B'), 'viewing_not_found');
    assert.equal(adminOwnershipCheck(agencyAViewing, 'agency-A'), 'ok');
  });
});

// ── rescheduleViewing status restoration ──────────────────────────────────────

type ViewingStatus = 'booked' | 'cancelled' | 'completed';

function simulateReschedule(
  currentStatus: ViewingStatus,
  newSlotIso: string
): { newStatus: ViewingStatus; newSlot: string } {
  // Mirrors the .set({ confirmed_slot, status: 'booked', ... }) in db/viewings.ts
  return { newStatus: 'booked', newSlot: newSlotIso };
}

describe('rescheduleViewing status restoration', () => {
  it('restores status to booked when rescheduling a booked viewing', () => {
    const { newStatus } = simulateReschedule('booked', '2026-06-20T10:00:00.000Z');
    assert.equal(newStatus, 'booked');
  });

  it('restores status to booked when rescheduling a previously cancelled viewing', () => {
    const { newStatus } = simulateReschedule('cancelled', '2026-06-20T10:00:00.000Z');
    assert.equal(newStatus, 'booked', 'reschedule should restore cancelled → booked');
  });

  it('updates the slot to the new ISO string', () => {
    const newSlot = '2026-06-22T14:00:00.000Z';
    const { newSlot: result } = simulateReschedule('booked', newSlot);
    assert.equal(result, newSlot);
  });

  it('does not preserve the old slot after reschedule', () => {
    const oldSlot = '2026-06-15T08:00:00.000Z';
    const newSlot = '2026-06-20T10:00:00.000Z';
    const { newSlot: result } = simulateReschedule('booked', newSlot);
    assert.notEqual(result, oldSlot);
  });
});

// ── book_viewing idempotency ───────────────────────────────────────────────────

type BookedSlotRecord = { conversation_id: string; confirmed_slot: string; status: string };

function simulateFindBookedSlot(
  existing: BookedSlotRecord[],
  conversationId: string,
  slotIso: string
): BookedSlotRecord | null {
  // Mirrors findBookedSlot logic in db/viewings.ts
  return existing.find(
    (r) =>
      r.conversation_id === conversationId &&
      r.confirmed_slot === slotIso &&
      r.status === 'booked'
  ) ?? null;
}

describe('book_viewing idempotency guard', () => {
  const existing: BookedSlotRecord[] = [
    { conversation_id: 'conv-A', confirmed_slot: '2026-06-15T08:00:00.000Z', status: 'booked' }
  ];

  it('returns existing booking when same conversation + slot already booked', () => {
    const found = simulateFindBookedSlot(existing, 'conv-A', '2026-06-15T08:00:00.000Z');
    assert.ok(found !== null, 'should detect duplicate booking');
  });

  it('allows booking when slot differs', () => {
    const found = simulateFindBookedSlot(existing, 'conv-A', '2026-06-16T10:00:00.000Z');
    assert.equal(found, null, 'different slot should not match');
  });

  it('allows same slot for a different conversation (independent leads)', () => {
    const found = simulateFindBookedSlot(existing, 'conv-B', '2026-06-15T08:00:00.000Z');
    assert.equal(found, null, 'same slot can be booked from different conversation');
  });

  it('does not match cancelled bookings (status filter)', () => {
    const withCancelled: BookedSlotRecord[] = [
      { conversation_id: 'conv-A', confirmed_slot: '2026-06-15T08:00:00.000Z', status: 'cancelled' }
    ];
    const found = simulateFindBookedSlot(withCancelled, 'conv-A', '2026-06-15T08:00:00.000Z');
    assert.equal(found, null, 'cancelled booking does not block re-booking the same slot');
  });
});

// ── admin book_viewing contact email resolution ────────────────────────────────

function resolveAdminBookingEmail(
  inputEmail: string | undefined,
  leadEmail: string | null
): { ok: false; error: 'need_contact_email' } | { ok: true; email: string } {
  // Mirrors admin book_viewing execute logic
  const email = inputEmail ?? leadEmail ?? undefined;
  if (!email) return { ok: false, error: 'need_contact_email' };
  return { ok: true, email };
}

describe('admin book_viewing email resolution', () => {
  it('uses input email when provided', () => {
    const r = resolveAdminBookingEmail('admin@example.com', null);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.email, 'admin@example.com');
  });

  it('falls back to lead email when input omitted', () => {
    const r = resolveAdminBookingEmail(undefined, 'lead@example.com');
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.email, 'lead@example.com');
  });

  it('returns need_contact_email when neither source provides an email', () => {
    const r = resolveAdminBookingEmail(undefined, null);
    assert.ok(!r.ok);
    if (!r.ok) assert.equal(r.error, 'need_contact_email');
  });

  it('prefers input email over lead email (allow override)', () => {
    const r = resolveAdminBookingEmail('new@example.com', 'old@example.com');
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.email, 'new@example.com');
  });
});

// ── remember_visitor_fact auto-tagging ────────────────────────────────────────

function applyAdminTag(facts: string[], date: string): string[] {
  // Mirrors [admin · {date}] tagging logic in main-assistant-tools.ts
  return facts.map((f) => (f.includes('[') ? f : `[admin · ${date}] ${f}`));
}

describe('remember_visitor_fact admin tagging', () => {
  const date = '2026-06-14';

  it('adds [admin · date] prefix to untagged facts', () => {
    const result = applyAdminTag(['Budget confirmed: 750k€'], date);
    assert.equal(result[0], '[admin · 2026-06-14] Budget confirmed: 750k€');
  });

  it('does not double-tag facts that already have brackets', () => {
    const result = applyAdminTag(['[admin · 2026-06-10] Prior fact'], date);
    assert.equal(result[0], '[admin · 2026-06-10] Prior fact', 'existing tag must be preserved as-is');
  });

  it('tags each fact independently', () => {
    const result = applyAdminTag(['Fact A', '[manual] Fact B', 'Fact C'], date);
    assert.equal(result[0], '[admin · 2026-06-14] Fact A');
    assert.equal(result[1], '[manual] Fact B');
    assert.equal(result[2], '[admin · 2026-06-14] Fact C');
  });

  it('preserves all facts (no items dropped)', () => {
    const facts = ['A', 'B', 'C'];
    const result = applyAdminTag(facts, date);
    assert.equal(result.length, facts.length);
  });
});

// ── viewing status transitions ─────────────────────────────────────────────────

type TransitionResult = 'ok' | 'already_cancelled' | 'already_completed';

function simulateCancelTransition(currentStatus: ViewingStatus): TransitionResult {
  // Mirrors expected behavior: cancel sets status = 'cancelled'
  // Optionally guard against re-cancellation or post-completion
  if (currentStatus === 'cancelled') return 'already_cancelled';
  if (currentStatus === 'completed') return 'already_completed';
  return 'ok';
}

describe('viewing status transitions', () => {
  it('can cancel a booked viewing', () => {
    assert.equal(simulateCancelTransition('booked'), 'ok');
  });

  it('re-cancelling an already-cancelled viewing is a no-op (idempotent)', () => {
    assert.equal(simulateCancelTransition('cancelled'), 'already_cancelled');
  });

  it('cannot cancel a completed viewing', () => {
    assert.equal(simulateCancelTransition('completed'), 'already_completed');
  });
});
