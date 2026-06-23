import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBotPromotionToAdmin } from '../../lib/telegram/bind-agency-group';

describe('isBotPromotionToAdmin', () => {
  it('true for member→administrator in a supergroup', () => {
    assert.equal(
      isBotPromotionToAdmin({
        chatType: 'supergroup',
        oldStatus: 'member',
        newStatus: 'administrator'
      }),
      true
    );
  });

  it('true for left→administrator (added straight as admin)', () => {
    assert.equal(
      isBotPromotionToAdmin({
        chatType: 'supergroup',
        oldStatus: 'left',
        newStatus: 'administrator'
      }),
      true
    );
  });

  it('false for admin→admin (no-op rights change)', () => {
    assert.equal(
      isBotPromotionToAdmin({
        chatType: 'supergroup',
        oldStatus: 'administrator',
        newStatus: 'administrator'
      }),
      false
    );
  });

  it('false for demotion administrator→member', () => {
    assert.equal(
      isBotPromotionToAdmin({
        chatType: 'supergroup',
        oldStatus: 'administrator',
        newStatus: 'member'
      }),
      false
    );
  });

  it('false for a non-supergroup chat (basic group)', () => {
    assert.equal(
      isBotPromotionToAdmin({
        chatType: 'group',
        oldStatus: 'member',
        newStatus: 'administrator'
      }),
      false
    );
  });

  it('false when promoted to plain member (not admin)', () => {
    assert.equal(
      isBotPromotionToAdmin({
        chatType: 'supergroup',
        oldStatus: 'left',
        newStatus: 'member'
      }),
      false
    );
  });
});
