import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentKeyboard, formatAgentLabel } from '../../lib/telegram/agent-command';

describe('buildAgentKeyboard', () => {
  it('always puts a Main button first', () => {
    const kb = buildAgentKeyboard([]);
    assert.deepEqual(kb.inline_keyboard[0], [{ text: '🤖 Main', callback_data: 'agent:main' }]);
  });
  it('adds one row per lead with agent:lead:<id> callback', () => {
    const kb = buildAgentKeyboard([{ id: 'l1', label: 'Marie' }]);
    assert.deepEqual(kb.inline_keyboard[1], [
      { text: '👤 Marie', callback_data: 'agent:lead:l1' }
    ]);
  });
  it('caps lead rows at max (default 8)', () => {
    const leads = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, label: `L${i}` }));
    const kb = buildAgentKeyboard(leads);
    // 1 Main row + 8 lead rows
    assert.equal(kb.inline_keyboard.length, 9);
  });
});

describe('formatAgentLabel', () => {
  it('labels null session as Main (default)', () => {
    assert.equal(formatAgentLabel(null), '🤖 Main');
  });
  it('labels main session', () => {
    assert.equal(formatAgentLabel({ agent_kind: 'main', lead_id: null }), '🤖 Main');
  });
  it('labels operator session with lead name', () => {
    assert.equal(
      formatAgentLabel({ agent_kind: 'operator', lead_id: 'l1' }, 'Marie'),
      '👤 Operator · Marie'
    );
  });
  it('falls back to "lead" when name missing', () => {
    assert.equal(
      formatAgentLabel({ agent_kind: 'operator', lead_id: 'l1' }, null),
      '👤 Operator · lead'
    );
  });
});
