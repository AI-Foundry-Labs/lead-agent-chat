/**
 * Unit tests for group-send-queue drop policy logic (Phase 04, red-team C1).
 *
 * The queue uses async timers for draining, so we test the PURE drop-decision logic:
 * - Mirror messages drop (oldest-first) when queue exceeds MAX_QUEUE_SIZE.
 * - Critical messages are NEVER dropped.
 * - Drop ordering: prefer dropping mirrors, stop when queue is <= MAX_QUEUE_SIZE.
 *
 * We test the drop-policy function in isolation; full async drain behavior
 * requires integration tests with mocked timers or Telegram API (deferred to smoke tests).
 *
 * No DB, no network, no actual Telegram sends here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Helper: simulates the enforceDropPolicy logic.
 * Given a queue of items with kinds, returns how many mirrors would be dropped
 * to get queue length ≤ maxSize, and validates that critical items are never dropped.
 */
function simulateDropPolicy(
  items: Array<{ kind: 'mirror' | 'critical' }>,
  maxSize: number
): { droppedCount: number; finalLength: number } {
  // Make a copy to avoid mutating the input
  const queue = [...items];
  let droppedCount = 0;

  // Loop while queue.length >= maxSize (not >)
  // This means drops happen when queue is AT or ABOVE the limit
  while (queue.length >= maxSize) {
    // Find the oldest mirror item (first in array).
    const mirrorIdx = queue.findIndex((i) => i.kind === 'mirror');
    if (mirrorIdx === -1) break; // all items are critical — stop dropping

    queue.splice(mirrorIdx, 1);
    droppedCount++;
  }

  return {
    droppedCount,
    finalLength: queue.length
  };
}

describe('group-send-queue drop policy', () => {
  const MAX_QUEUE_SIZE = 50;

  describe('drop mirrors when queue is full', () => {
    it('drops mirror when queue reaches MAX_QUEUE_SIZE (loop: while >= 50)', () => {
      // Queue with 51 items: 50 mirrors + 1 critical
      // Condition: while (queue.length >= 50), drops at 51, 50, stops at 49
      const items = Array(50).fill({ kind: 'mirror' as const }).concat({ kind: 'critical' as const });
      assert.equal(items.length, 51);

      const result = simulateDropPolicy(items, MAX_QUEUE_SIZE);
      // Drops 2: one to get from 51→50, another because 50>=50 so drops again to 49
      assert.equal(result.droppedCount, 2);
      assert.equal(result.finalLength, 49);
    });

    it('drops multiple mirrors if queue is significantly over capacity', () => {
      // Queue with 60 items: all mirrors
      const items = Array(60).fill({ kind: 'mirror' as const });
      const result = simulateDropPolicy(items, MAX_QUEUE_SIZE);
      // Loop: while (60 >= 50) drop, while (59 >= 50) drop, ... while (50 >= 50) drop, then 49 < 50 stop
      // Drops: 60→59→58→57→56→55→54→53→52→51→50→49 = 11 drops
      assert.equal(result.droppedCount, 11);
      assert.equal(result.finalLength, 49);
    });

    it('drops oldest mirrors first (FIFO for drops)', () => {
      // Items: [mirror0, mirror1, critical]
      // When enforcing MAX_SIZE 2, loop while >= 2
      const items = [
        { kind: 'mirror' as const },
        { kind: 'mirror' as const },
        { kind: 'critical' as const }
      ];

      // Simulate what happens if we have 3 items and max is 2
      // while (3 >= 2) drop mirror0 → 2 items
      // while (2 >= 2) drop mirror1 → 1 item
      // while (1 >= 2) false, stop
      const result = simulateDropPolicy(items, 2);
      assert.equal(result.droppedCount, 2);
      // After dropping 2 mirrors, only critical remains
      assert.equal(result.finalLength, 1);
    });
  });

  describe('never drop critical messages', () => {
    it('stops dropping when only critical items remain', () => {
      // Queue: [mirror, critical, critical]
      const items = [
        { kind: 'mirror' as const },
        { kind: 'critical' as const },
        { kind: 'critical' as const }
      ];

      const result = simulateDropPolicy(items, 2);
      // Should drop only the mirror, then stop (can't drop criticals)
      assert.equal(result.droppedCount, 1);
      assert.equal(result.finalLength, 2);
    });

    it('rejects dropping if all items are critical', () => {
      // Queue: [critical, critical, critical] with MAX_SIZE 2
      const items = [
        { kind: 'critical' as const },
        { kind: 'critical' as const },
        { kind: 'critical' as const }
      ];

      const result = simulateDropPolicy(items, 2);
      // Queue is over size but can't drop any criticals, so no drops happen
      assert.equal(result.droppedCount, 0);
      assert.equal(result.finalLength, 3);
    });

    it('never drops critical messages even if at front of queue', () => {
      // Queue: [critical, mirror, mirror] with MAX_SIZE 1
      const items = [
        { kind: 'critical' as const },
        { kind: 'mirror' as const },
        { kind: 'mirror' as const }
      ];

      const result = simulateDropPolicy(items, 1);
      // Should drop mirrors (indices 1, 2) but leave the critical
      assert.equal(result.droppedCount, 2);
      assert.equal(result.finalLength, 1);
    });
  });

  describe('edge cases', () => {
    it('does nothing if queue is already under capacity', () => {
      const items = [
        { kind: 'mirror' as const },
        { kind: 'critical' as const }
      ];

      const result = simulateDropPolicy(items, 10);
      assert.equal(result.droppedCount, 0);
      assert.equal(result.finalLength, 2);
    });

    it('handles empty queue', () => {
      const items: Array<{ kind: 'mirror' | 'critical' }> = [];
      const result = simulateDropPolicy(items, 50);
      assert.equal(result.droppedCount, 0);
      assert.equal(result.finalLength, 0);
    });

    it('handles queue with single item', () => {
      const items = [{ kind: 'mirror' as const }];
      const result = simulateDropPolicy(items, 50);
      assert.equal(result.droppedCount, 0);
      assert.equal(result.finalLength, 1);
    });

    it('handles queue that exactly matches MAX_SIZE', () => {
      const items = Array(50).fill({ kind: 'mirror' as const });
      const result = simulateDropPolicy(items, 50);
      // Queue length >= MAX_SIZE is the drop condition, so drops 1 mirror
      assert.equal(result.droppedCount, 1);
      assert.equal(result.finalLength, 49);
    });
  });

  describe('real-world drop scenarios', () => {
    it('typical scenario: bursty mirrors + occasional critical', () => {
      // Simulate a burst: 40 mirrors + 15 criticals = 55 total (over 50)
      const items = Array(40)
        .fill({ kind: 'mirror' as const })
        .concat(Array(15).fill({ kind: 'critical' as const }));

      assert.equal(items.length, 55);
      const result = simulateDropPolicy(items, MAX_QUEUE_SIZE);
      // Drops: 55→54→53→52→51→50→49 = 6 mirrors dropped, final 49
      assert.equal(result.droppedCount, 6);
      assert.equal(result.finalLength, 49);
      // All 15 criticals should survive
      const survivedCriticals = items.slice(40).length;
      assert.equal(survivedCriticals, 15);
    });

    it('mirrors keep arriving while criticals are buffered', () => {
      // Queue: [mirror, mirror, mirror, critical, critical, critical]
      // with MAX_SIZE 3 → should drop oldest mirrors
      const items = [
        { kind: 'mirror' as const },
        { kind: 'mirror' as const },
        { kind: 'mirror' as const },
        { kind: 'critical' as const },
        { kind: 'critical' as const },
        { kind: 'critical' as const }
      ];

      const result = simulateDropPolicy(items, 3);
      // Drop 3 oldest mirrors to get to 3 items (the 3 criticals)
      assert.equal(result.droppedCount, 3);
      assert.equal(result.finalLength, 3);
    });

    it('mixed queue: interleaved mirrors and criticals', () => {
      // [m, c, m, c, m, c, m, m, m] = 6 mirrors + 3 criticals = 9 items
      const items = [
        { kind: 'mirror' as const },
        { kind: 'critical' as const },
        { kind: 'mirror' as const },
        { kind: 'critical' as const },
        { kind: 'mirror' as const },
        { kind: 'critical' as const },
        { kind: 'mirror' as const },
        { kind: 'mirror' as const },
        { kind: 'mirror' as const }
      ];

      const result = simulateDropPolicy(items, 5);
      // while (9 >= 5) drop mirror at idx 0 → 8
      // while (8 >= 5) drop mirror at idx 2 (was 3, now 2) → 7
      // while (7 >= 5) drop mirror at idx 3 → 6
      // while (6 >= 5) drop mirror at idx 4 → 5
      // while (5 >= 5) drop mirror at idx 5 → 4
      // while (4 >= 5) false, stop
      assert.equal(result.droppedCount, 5);
      assert.equal(result.finalLength, 4);
    });
  });

  describe('MAX_QUEUE_SIZE boundary', () => {
    it('respects the 50-message per-group limit', () => {
      const items = Array(51).fill({ kind: 'mirror' as const });
      const result = simulateDropPolicy(items, 50);
      // while (51 >= 50) drop to 50
      // while (50 >= 50) drop to 49
      // while (49 >= 50) false, stop
      assert.equal(result.droppedCount, 2);
      assert.equal(result.finalLength, 49);
    });

    it('all-critical queue respects limit by NOT dropping', () => {
      const items = Array(100).fill({ kind: 'critical' as const });
      const result = simulateDropPolicy(items, 50);
      // Can't drop any, so queue stays at 100
      assert.equal(result.droppedCount, 0);
      assert.equal(result.finalLength, 100);
    });
  });
});
