/**
 * Unit tests for the agentic staff-report DETERMINISTIC core (no LLM, no network).
 *
 * generateStaffReport() calls an LLM, but its safety contract is that on any
 * failure it returns the original notification-strings template — never empty,
 * never a message addressed to the prospect. We test that fallback + the marker
 * map directly. The live LLM path is covered by an llm-contract test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  staffReportFallback,
  STAFF_MARKER,
  type StaffEvent
} from '../../lib/agent/staff-report.ts';
import { notif } from '../../lib/agent/notification-strings.ts';
import type { Language } from '../../lib/types.ts';

const EVENTS: StaffEvent[] = [
  { kind: 'handoff', rule: 'mot de la fin', message: 'je veux négocier le prix' },
  { kind: 'manual', message: 'bonjour, une question' },
  { kind: 'viewing_booked', title: 'Studio Montmartre', slot: 'lun. 10:00', contact: 'Duc <d@x.fr>' },
  { kind: 'handoff_requested', reason: 'sujet sensible', leadName: 'Duc' }
];

const LANGS: Language[] = ['fr', 'en'];

describe('staff-report deterministic fallback', () => {
  for (const lang of LANGS) {
    for (const event of EVENTS) {
      it(`[${lang}] ${event.kind}: fallback is non-empty`, () => {
        const out = staffReportFallback(event, lang);
        assert.ok(out.trim().length > 0, 'fallback must never be empty');
      });
    }
  }

  it('fallback equals the corresponding notification-strings template (fr)', () => {
    const n = notif('fr');
    assert.equal(
      staffReportFallback({ kind: 'manual', message: 'salut' }, 'fr'),
      n.manual('salut')
    );
    assert.equal(
      staffReportFallback({ kind: 'handoff', rule: 'R', message: 'M' }, 'fr'),
      n.handoff('R', 'M')
    );
    assert.equal(
      staffReportFallback(
        { kind: 'viewing_booked', title: 'T', slot: 'S', contact: 'C' },
        'fr'
      ),
      n.viewing_booked_chat('T', 'S', 'C')
    );
    assert.equal(
      staffReportFallback({ kind: 'handoff_requested', reason: 'X' }, 'fr'),
      n.handoff_requested('X')
    );
  });

  it('unknown language falls back to French template (notif default)', () => {
    const out = staffReportFallback({ kind: 'manual', message: 'm' }, 'xx' as Language);
    assert.equal(out, notif('fr').manual('m'));
  });

  it('every event kind has a leading marker', () => {
    for (const event of EVENTS) {
      assert.ok(STAFF_MARKER[event.kind], `missing marker for ${event.kind}`);
    }
  });
});
