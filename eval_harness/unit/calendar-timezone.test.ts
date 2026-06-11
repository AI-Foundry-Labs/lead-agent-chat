/**
 * Unit tests for Paris timezone slot generation.
 * Logic inlined from lib/calendar.ts — no external deps needed.
 *
 * Key invariants:
 *   CET  (winter, Nov–Mar): UTC+1 → 9h Paris = 08:00 UTC
 *   CEST (summer, Apr–Oct): UTC+2 → 9h Paris = 07:00 UTC
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline pure functions under test ─────────────────────────────────────────

function parisUtcOffset(d: Date): number {
  const parisFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    hour12: false
  });
  const utcFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: 'numeric',
    hour12: false
  });
  const parisHour = parseInt(parisFmt.format(d), 10);
  const utcHour = parseInt(utcFmt.format(d), 10);
  let offset = parisHour - utcHour;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  return offset;
}

function isWeekday(d: Date): boolean {
  const w = d.getUTCDay();
  return w !== 0 && w !== 6;
}

function* candidateSlots(start: Date, daysAhead: number) {
  const hours = [9, 11, 14, 16];
  for (let day = 1; day <= daysAhead; day++) {
    const d = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
    if (!isWeekday(d)) continue;
    const offset = parisUtcOffset(d);
    for (const h of hours) {
      const slot = new Date(d);
      slot.setUTCHours(h - offset, 0, 0, 0);
      yield slot;
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parisUtcOffset', () => {
  it('returns +1 in winter (CET)', () => {
    // January 15 — CET (UTC+1)
    const jan = new Date('2026-01-15T12:00:00Z');
    assert.equal(parisUtcOffset(jan), 1);
  });

  it('returns +2 in summer (CEST)', () => {
    // July 15 — CEST (UTC+2)
    const jul = new Date('2026-07-15T12:00:00Z');
    assert.equal(parisUtcOffset(jul), 2);
  });

  it('returns +2 after clocks spring forward (late March)', () => {
    // Paris switches last Sunday of March — April 1 is always CEST
    const apr = new Date('2026-04-01T12:00:00Z');
    assert.equal(parisUtcOffset(apr), 2);
  });

  it('returns +1 after clocks fall back (late October)', () => {
    // Paris switches last Sunday of October — November 1 is always CET
    const nov = new Date('2026-11-01T12:00:00Z');
    assert.equal(parisUtcOffset(nov), 1);
  });
});

describe('candidateSlots — slot UTC hours', () => {
  it('generates 9h Paris slots at 07:00 UTC in summer (CEST +2)', () => {
    // Start from a Friday in summer so next weekday is Monday
    const friday = new Date('2026-07-10T00:00:00Z'); // Fri
    const slots = [...candidateSlots(friday, 4)]; // Mon–Thu
    const monSlots = slots.filter(
      (s) => s.getUTCDay() === 1 // Monday
    );
    assert.ok(monSlots.length > 0, 'expected Monday slots');
    const first = monSlots[0];
    assert.equal(first.getUTCHours(), 7, '9h Paris CEST = 07:00 UTC');
  });

  it('generates 9h Paris slots at 08:00 UTC in winter (CET +1)', () => {
    // Start from a Friday in winter
    const friday = new Date('2026-01-09T00:00:00Z'); // Fri
    const slots = [...candidateSlots(friday, 4)]; // Mon–Thu
    const monSlots = slots.filter((s) => s.getUTCDay() === 1);
    assert.ok(monSlots.length > 0, 'expected Monday slots');
    const first = monSlots[0];
    assert.equal(first.getUTCHours(), 8, '9h Paris CET = 08:00 UTC');
  });

  it('skips weekends', () => {
    // Start on a Thursday — only Friday before weekend is valid next
    const thursday = new Date('2026-01-08T00:00:00Z'); // Thu
    const slots = [...candidateSlots(thursday, 3)]; // Fri, Sat, Sun
    for (const s of slots) {
      const day = s.getUTCDay();
      assert.ok(day !== 0 && day !== 6, `Weekend slot generated: ${s.toISOString()}`);
    }
  });

  it('generates exactly 4 slots per weekday', () => {
    // 5 weekdays in the window
    const sunday = new Date('2026-01-11T00:00:00Z');
    const slots = [...candidateSlots(sunday, 7)];
    // Should have 5 weekdays × 4 slots = 20
    assert.equal(slots.length, 20);
  });
});
