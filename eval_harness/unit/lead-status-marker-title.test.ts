/**
 * Unit tests for the status-marker title formatting (lib/telegram/lead-status-marker.ts).
 *
 * The marker prepends a hot/warm/cold emoji to the standard 💬 Conversation topic
 * title. We verify the composed title shape using the same public builders the
 * marker uses, so the lead name / listing / anon-seq fallbacks stay intact and
 * only a leading emoji is added.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeadDisplayName,
  buildConversationTopicTitle
} from '../../lib/telegram/lead-topics';

// Mirror of the marker's emoji map (kept in sync intentionally).
const STATUS_EMOJI = { hot: '🔥', warm: '🟡', cold: '❄️' } as const;

function markerTitle(
  status: keyof typeof STATUS_EMOJI,
  name: string | null,
  email: string | null,
  listing: string | null,
  anonSeq?: number | null
): string {
  const displayName = buildLeadDisplayName(name, email, anonSeq);
  return `${STATUS_EMOJI[status]} ${buildConversationTopicTitle(displayName, listing)}`;
}

describe('status marker title', () => {
  it('prepends the hot emoji to a named lead + listing', () => {
    assert.equal(
      markerTitle('hot', 'Marie D.', null, 'Marais 2BR'),
      '🔥 💬 Marie D. — Marais 2BR'
    );
  });

  it('uses the warm emoji', () => {
    assert.equal(
      markerTitle('warm', 'Marie D.', null, 'Marais 2BR'),
      '🟡 💬 Marie D. — Marais 2BR'
    );
  });

  it('uses the cold emoji', () => {
    assert.equal(
      markerTitle('cold', 'Marie D.', null, 'Marais 2BR'),
      '❄️ 💬 Marie D. — Marais 2BR'
    );
  });

  it('keeps the anonymous sequence name in the title', () => {
    assert.equal(
      markerTitle('hot', null, null, 'Marais 2BR', 7),
      '🔥 💬 Visiteur #7 — Marais 2BR'
    );
  });

  it('omits listing when absent', () => {
    assert.equal(markerTitle('cold', 'John', null, null), '❄️ 💬 John');
  });
});
