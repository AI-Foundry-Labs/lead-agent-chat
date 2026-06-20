/**
 * Tests for lib/agent/cross-thread-context.ts — pure helper only.
 * formatConversationForMemory is the only pure export; the async functions
 * (buildCrossThreadContextBlock, threadMemoryTag) require DB and are not tested here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatConversationForMemory } from '../../../lib/agent/cross-thread-context.ts';
import type { Conversation } from '../../../lib/types.ts';

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
    agency_id: 'agency-1',
    type: 'lead',
    mode: 'agent',
    primary_channel: 'web',
    lead_id: 'lead-1',
    admin_id: null,
    listing_id: 'lst-1',
    thread_summary: null,
    summarized_turn_count: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

describe('formatConversationForMemory', () => {
  it('produces channel · listing · thread:<8-char-id> format', () => {
    const conv = makeConv({ primary_channel: 'web', listing_id: 'lst-1', id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff' });
    const tag = formatConversationForMemory(conv);
    assert.equal(tag, 'web · listing:lst-1 · thread:aaaabbbb');
  });

  it('uses "general" when listing_id is null', () => {
    const conv = makeConv({ listing_id: null });
    const tag = formatConversationForMemory(conv);
    assert.ok(tag.includes('listing:general'));
  });

  it('truncates thread id to 8 characters', () => {
    const conv = makeConv({ id: '12345678-abcd-0000-0000-000000000000' });
    const tag = formatConversationForMemory(conv);
    assert.ok(tag.includes('thread:12345678'), 'should use first 8 chars of UUID');
    assert.ok(!tag.includes('12345678-'), 'should not include the dash after 8 chars');
  });

  it('reflects telegram channel', () => {
    const conv = makeConv({ primary_channel: 'telegram' });
    const tag = formatConversationForMemory(conv);
    assert.ok(tag.startsWith('telegram ·'));
  });

  it('reflects email channel', () => {
    const conv = makeConv({ primary_channel: 'email' });
    const tag = formatConversationForMemory(conv);
    assert.ok(tag.startsWith('email ·'));
  });

  it('produces different tags for different conversations', () => {
    const a = makeConv({ id: 'aaaa0000-0000-0000-0000-000000000000', primary_channel: 'web' });
    const b = makeConv({ id: 'bbbb0000-0000-0000-0000-000000000000', primary_channel: 'telegram' });
    assert.notEqual(formatConversationForMemory(a), formatConversationForMemory(b));
  });
});
