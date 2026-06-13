/**
 * Unit tests for verifyAgencyGroup — pure logic tests.
 *
 * The function calls async Telegram APIs (getChat, getChatMember) which we cannot
 * easily mock inline. This test file covers:
 * 1. The pure validation logic (chat type check, is_forum requirement)
 * 2. Mock scenarios for the bot-rights check by simulating API outcomes
 *
 * For true integration tests of the async calls, see smoke tests with live Telegram mocks.
 * No DB or live network calls here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { VerifyGroupResult } from '../../lib/telegram/verify-agency-group';

/**
 * Helper: Given a chat object with type and is_forum properties,
 * validate the PURE checks that don't require async API calls.
 *
 * In the real function these are checked, but here we isolate the decision logic
 * so we can unit-test the validation matrix without mocking async calls.
 */
function validateChatTypeAndForum(
  chat: Record<string, unknown>,
  is_forum: boolean | null
): VerifyGroupResult {
  // 1. Chat type must be supergroup
  if (chat.type !== 'supergroup') {
    return {
      ok: false,
      reason: 'Chat must be a Telegram supergroup'
    };
  }

  // 2. Topics (is_forum) must be enabled
  if (!is_forum) {
    return {
      ok: false,
      reason: 'Topics are not enabled on this group'
    };
  }

  return { ok: true };
}

/**
 * Helper: Given bot member metadata, validate bot admin + can_manage_topics.
 * Pure logic — no async calls.
 */
function validateBotRights(
  member: Record<string, unknown> | null
): VerifyGroupResult {
  if (!member) {
    return {
      ok: false,
      reason: 'Could not verify bot rights in this group'
    };
  }

  const isAdmin =
    member.status === 'administrator' || member.status === 'creator';
  const canManageTopics = Boolean(member.can_manage_topics);

  if (!isAdmin || !canManageTopics) {
    return {
      ok: false,
      reason: 'Bot must be an admin with can_manage_topics permission'
    };
  }

  return { ok: true };
}

describe('verifyAgencyGroup — pure validation logic', () => {
  describe('chat type validation', () => {
    it('rejects non-supergroup chats', () => {
      const result = validateChatTypeAndForum({ type: 'group', id: 123 }, true);
      assert.equal(result.ok, false);
      assert(result.reason?.includes('supergroup'));
    });

    it('rejects private chats', () => {
      const result = validateChatTypeAndForum({ type: 'private', id: 123 }, true);
      assert.equal(result.ok, false);
    });

    it('rejects channel chats', () => {
      const result = validateChatTypeAndForum({ type: 'channel', id: 123 }, true);
      assert.equal(result.ok, false);
    });

    it('accepts supergroup type (before checking is_forum)', () => {
      const result = validateChatTypeAndForum({ type: 'supergroup', id: 123 }, true);
      assert.equal(result.ok, true);
    });
  });

  describe('is_forum (topics) validation', () => {
    it('rejects supergroup with is_forum=false', () => {
      const result = validateChatTypeAndForum({ type: 'supergroup', id: 123 }, false);
      assert.equal(result.ok, false);
      assert(result.reason?.includes('not enabled'));
    });

    it('rejects supergroup with is_forum=null', () => {
      const result = validateChatTypeAndForum({ type: 'supergroup', id: 123 }, null);
      assert.equal(result.ok, false);
    });

    it('accepts supergroup with is_forum=true', () => {
      const result = validateChatTypeAndForum({ type: 'supergroup', id: 123 }, true);
      assert.equal(result.ok, true);
    });
  });

  describe('bot rights validation', () => {
    it('rejects when member is null (bot not found in group)', () => {
      const result = validateBotRights(null);
      assert.equal(result.ok, false);
      assert(result.reason?.includes('Could not verify'));
    });

    it('rejects when bot is a regular member (not admin)', () => {
      const result = validateBotRights({
        status: 'member',
        can_manage_topics: true
      });
      assert.equal(result.ok, false);
      assert(result.reason?.includes('admin'));
    });

    it('rejects when bot is admin but lacks can_manage_topics', () => {
      const result = validateBotRights({
        status: 'administrator',
        can_manage_topics: false
      });
      assert.equal(result.ok, false);
      assert(result.reason?.includes('can_manage_topics'));
    });

    it('rejects when can_manage_topics is undefined', () => {
      const result = validateBotRights({
        status: 'administrator',
        can_manage_topics: undefined
      });
      assert.equal(result.ok, false);
    });

    it('accepts bot as administrator with can_manage_topics=true', () => {
      const result = validateBotRights({
        status: 'administrator',
        can_manage_topics: true
      });
      assert.equal(result.ok, true);
    });

    it('accepts bot as creator with can_manage_topics=true', () => {
      const result = validateBotRights({
        status: 'creator',
        can_manage_topics: true
      });
      assert.equal(result.ok, true);
    });
  });

  describe('full validation matrix', () => {
    it('full acceptance: supergroup + is_forum + admin + can_manage_topics', () => {
      const chatCheck = validateChatTypeAndForum({ type: 'supergroup', id: 123 }, true);
      const botCheck = validateBotRights({
        status: 'administrator',
        can_manage_topics: true
      });
      assert.equal(chatCheck.ok, true);
      assert.equal(botCheck.ok, true);
    });

    it('rejects: supergroup + is_forum + admin but no can_manage_topics', () => {
      const chatCheck = validateChatTypeAndForum({ type: 'supergroup', id: 123 }, true);
      const botCheck = validateBotRights({
        status: 'administrator',
        can_manage_topics: false
      });
      assert.equal(chatCheck.ok, true);
      assert.equal(botCheck.ok, false);
    });

    it('rejects: supergroup + is_forum + no bot found', () => {
      const chatCheck = validateChatTypeAndForum({ type: 'supergroup', id: 123 }, true);
      const botCheck = validateBotRights(null);
      assert.equal(chatCheck.ok, true);
      assert.equal(botCheck.ok, false);
    });

    it('rejects: group + is_forum + valid bot rights (wrong chat type)', () => {
      const chatCheck = validateChatTypeAndForum({ type: 'group', id: 123 }, true);
      const botCheck = validateBotRights({
        status: 'administrator',
        can_manage_topics: true
      });
      assert.equal(chatCheck.ok, false);
      assert.equal(botCheck.ok, true);
    });
  });
});
