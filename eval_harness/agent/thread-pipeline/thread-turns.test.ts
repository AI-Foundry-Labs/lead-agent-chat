/**
 * Tests for lib/agent/thread-turns.ts — pure message grouping functions.
 * No DB, no LLM. These verify the turn-grouping logic used to build LLM context.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupMessagesIntoTurns,
  formatTurnsForSummary,
  flattenRecentTurns
} from '../../../lib/agent/thread-turns.ts';
import type { Message } from '../../../lib/types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function msg(role: Message['role'], content: string, id = 'id-' + Math.random()): Message {
  return {
    id,
    conversation_id: 'conv-1',
    role,
    content,
    is_draft: false,
    is_visible: true,
    timestamp: new Date()
  };
}

// ── groupMessagesIntoTurns ─────────────────────────────────────────────────────

describe('groupMessagesIntoTurns', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(groupMessagesIntoTurns([]), []);
  });

  it('groups a single user+assistant pair into one turn', () => {
    const msgs = [msg('user', 'Hello'), msg('assistant', 'Hi there!')];
    const turns = groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].user.content, 'Hello');
    assert.equal(turns[0].replies.length, 1);
    assert.equal(turns[0].replies[0].content, 'Hi there!');
  });

  it('groups multiple user messages into separate turns', () => {
    const msgs = [
      msg('user', 'Q1'),
      msg('assistant', 'A1'),
      msg('user', 'Q2'),
      msg('assistant', 'A2')
    ];
    const turns = groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].user.content, 'Q1');
    assert.equal(turns[1].user.content, 'Q2');
  });

  it('collects multiple assistant replies under same user turn', () => {
    const msgs = [
      msg('user', 'Tell me more'),
      msg('assistant', 'Part 1'),
      msg('assistant', 'Part 2')
    ];
    const turns = groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].replies.length, 2);
  });

  it('includes admin messages in replies (admin takeover scenario)', () => {
    const msgs = [
      msg('user', 'Need help'),
      msg('admin', 'Sure, let me help')
    ];
    const turns = groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].replies.length, 1);
    assert.equal(turns[0].replies[0].role, 'admin');
  });

  it('ignores assistant messages before first user message', () => {
    // System-injected assistant msg at start — should not crash, just be discarded
    const msgs = [msg('assistant', 'stray'), msg('user', 'Hi'), msg('assistant', 'Reply')];
    const turns = groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].user.content, 'Hi');
  });

  it('handles user message with no reply (trailing unanswered message)', () => {
    const msgs = [msg('user', 'Q1'), msg('assistant', 'A1'), msg('user', 'Q2 — unanswered')];
    const turns = groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 2);
    assert.equal(turns[1].replies.length, 0);
  });
});

// ── formatTurnsForSummary ──────────────────────────────────────────────────────

describe('formatTurnsForSummary', () => {
  it('formats a single turn as User: / Assistant:', () => {
    const turns = groupMessagesIntoTurns([msg('user', 'What is the price?'), msg('assistant', '€650,000')]);
    const text = formatTurnsForSummary(turns);
    assert.ok(text.includes('User: What is the price?'));
    assert.ok(text.includes('Assistant: €650,000'));
  });

  it('separates turns with blank lines', () => {
    const msgs = [
      msg('user', 'Q1'), msg('assistant', 'A1'),
      msg('user', 'Q2'), msg('assistant', 'A2')
    ];
    const text = formatTurnsForSummary(groupMessagesIntoTurns(msgs));
    // Should have double newline between turns
    assert.ok(text.includes('\n\n'), 'turns should be separated by blank lines');
  });

  it('returns empty string for empty turns array', () => {
    assert.equal(formatTurnsForSummary([]), '');
  });

  it('formats turn with no reply (only User: line)', () => {
    const turns = groupMessagesIntoTurns([msg('user', 'Just browsing')]);
    const text = formatTurnsForSummary(turns);
    assert.ok(text.includes('User: Just browsing'));
    assert.ok(!text.includes('Assistant:'));
  });
});

// ── flattenRecentTurns ─────────────────────────────────────────────────────────

describe('flattenRecentTurns', () => {
  it('returns all messages in order (user then replies)', () => {
    const u1 = msg('user', 'Q1');
    const a1 = msg('assistant', 'A1');
    const u2 = msg('user', 'Q2');
    const a2 = msg('assistant', 'A2');
    const turns = groupMessagesIntoTurns([u1, a1, u2, a2]);
    const flat = flattenRecentTurns(turns);
    assert.equal(flat.length, 4);
    assert.equal(flat[0].content, 'Q1');
    assert.equal(flat[1].content, 'A1');
    assert.equal(flat[2].content, 'Q2');
    assert.equal(flat[3].content, 'A2');
  });

  it('returns empty array for empty turns', () => {
    assert.deepEqual(flattenRecentTurns([]), []);
  });

  it('preserves original Message references (not copies)', () => {
    const u = msg('user', 'Hello');
    const a = msg('assistant', 'Hi');
    const turns = groupMessagesIntoTurns([u, a]);
    const flat = flattenRecentTurns(turns);
    assert.equal(flat[0], u);
    assert.equal(flat[1], a);
  });
});
