/**
 * Unit tests for resolveSlotIso (lib/calendar.ts).
 *
 * Regression for the booking-corruption bug: the LLM echoes the offered slot ISO
 * but frequently (a) drops the Paris `+02:00` offset → the hour reads as UTC and
 * shifts +2h when displayed, and/or (b) hallucinates the year. resolveSlotIso must
 * snap any such mangled string back to the real candidate slot (correct year +
 * correct offset) by matching the Paris wall-clock month/day/hour.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSlotIso } from '../../lib/calendar';

// Pick the first real candidate the generator would offer, to test against.
import { getAvailableSlots } from '../../lib/calendar';

describe('resolveSlotIso', () => {
  it('recovers the canonical ISO from a model string with the offset dropped', async () => {
    const [offered] = await getAvailableSlots({
      calendarId: 'mock',
      preferredTimeline: null,
      count: 1
    });
    // offered looks like "2026-06-15T09:00:00+02:00".
    const m = offered.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):/)!;
    // Simulate the model dropping the offset (treats wall-clock as UTC "Z").
    const mangled = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:00:00Z`;
    const resolved = resolveSlotIso(mangled);
    assert.equal(resolved, offered);
  });

  it('recovers the canonical ISO from a model string with a hallucinated year', async () => {
    const [offered] = await getAvailableSlots({
      calendarId: 'mock',
      preferredTimeline: null,
      count: 1
    });
    const m = offered.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):/)!;
    // Simulate the exact observed bug: wrong year (2023) AND dropped offset.
    const mangled = `2023-${m[2]}-${m[3]}T${m[4]}:00:00+00:00`;
    const resolved = resolveSlotIso(mangled);
    assert.equal(resolved, offered, 'should snap back to the real offered slot');
    // The recovered ISO carries the correct Paris offset, not UTC.
    assert.match(resolved!, /\+0[12]:00$/);
  });

  it('returns the exact same string when given an uncorrupted offered ISO', async () => {
    const [offered] = await getAvailableSlots({
      calendarId: 'mock',
      preferredTimeline: null,
      count: 1
    });
    assert.equal(resolveSlotIso(offered), offered);
  });

  it('returns null for an unparseable string', () => {
    assert.equal(resolveSlotIso('not-a-date'), null);
    assert.equal(resolveSlotIso(''), null);
  });

  it('returns null for a wall-clock that is never offered (e.g. 03:00)', async () => {
    const [offered] = await getAvailableSlots({
      calendarId: 'mock',
      preferredTimeline: null,
      count: 1
    });
    const m = offered.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):/)!;
    // 03:00 is not in the candidate hour set [9, 11, 14, 16].
    const bogus = `${m[1]}-${m[2]}-${m[3]}T03:00:00+02:00`;
    assert.equal(resolveSlotIso(bogus), null);
  });
});
