import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveActor } from '../../lib/db/telegram-agent-sessions';

describe('resolveActiveActor', () => {
  it('returns null when no session', () => {
    assert.equal(resolveActiveActor(null), null);
  });
  it('maps main session to main_assistant actor', () => {
    assert.deepEqual(resolveActiveActor({ agent_kind: 'main', lead_id: null }), {
      type: 'main_assistant'
    });
  });
  it('maps operator session to operator actor with leadId', () => {
    assert.deepEqual(
      resolveActiveActor({ agent_kind: 'operator', lead_id: 'lead-1' }),
      { type: 'operator', leadId: 'lead-1' }
    );
  });
});
