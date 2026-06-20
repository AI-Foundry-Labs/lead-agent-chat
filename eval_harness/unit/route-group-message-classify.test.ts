/**
 * Unit tests for the pure classifyGroupThread function (Phase 04).
 * No DB — pure logic only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGroupThread } from '../../lib/telegram/route-group-message';

describe('classifyGroupThread', () => {
  it('returns general when threadId is undefined', () => {
    assert.equal(
      classifyGroupThread({ conversationTopicId: 10, assistantTopicId: 20, threadId: undefined }),
      'general'
    );
  });

  it('returns topic1_conversation when threadId matches conversationTopicId', () => {
    assert.equal(
      classifyGroupThread({ conversationTopicId: 10, assistantTopicId: 20, threadId: 10 }),
      'topic1_conversation'
    );
  });

  it('returns topic2_assistant when threadId matches assistantTopicId', () => {
    assert.equal(
      classifyGroupThread({ conversationTopicId: 10, assistantTopicId: 20, threadId: 20 }),
      'topic2_assistant'
    );
  });

  it('returns unknown when threadId matches neither topic', () => {
    assert.equal(
      classifyGroupThread({ conversationTopicId: 10, assistantTopicId: 20, threadId: 99 }),
      'unknown'
    );
  });

  it('returns unknown when both topic ids are null', () => {
    assert.equal(
      classifyGroupThread({ conversationTopicId: null, assistantTopicId: null, threadId: 5 }),
      'unknown'
    );
  });

  it('returns topic1_conversation when assistantTopicId is null but conv matches', () => {
    assert.equal(
      classifyGroupThread({ conversationTopicId: 7, assistantTopicId: null, threadId: 7 }),
      'topic1_conversation'
    );
  });

  it('topic1_conversation takes precedence if ids are equal (degenerate config)', () => {
    // Should not happen in practice but the classify function checks conv first.
    assert.equal(
      classifyGroupThread({ conversationTopicId: 5, assistantTopicId: 5, threadId: 5 }),
      'topic1_conversation'
    );
  });
});
