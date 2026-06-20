import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotificationTargets } from '../../lib/agent/push-agent-notification';

describe('buildNotificationTargets', () => {
  it('writes the same content to operator and main conversations', () => {
    const t = buildNotificationTargets('op-1', 'main-1', 'Handoff: price talk');
    assert.deepEqual(t, [
      { conversation_id: 'op-1', role: 'assistant', content: 'Handoff: price talk' },
      { conversation_id: 'main-1', role: 'assistant', content: 'Handoff: price talk' }
    ]);
  });
  it('omits duplicate when operator and main are the same conversation', () => {
    const t = buildNotificationTargets('same', 'same', 'x');
    assert.equal(t.length, 1);
  });
});
