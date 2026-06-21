import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentKeyboard,
  buildLeadsKeyboard,
  buildLeadPickerKeyboard,
  formatAgentLabel,
  AGENT_PAGE_SIZE,
} from '../../lib/telegram/agent-command';

// ─── buildAgentKeyboard ────────────────────────────────────────────────────

describe('buildAgentKeyboard — no active session (undefined)', () => {
  it('highlights Main with ✅ when no activeLeadId given', () => {
    const kb = buildAgentKeyboard([]);
    assert.deepEqual(kb.inline_keyboard[0], [{ text: '✅ 🤖 Main', callback_data: 'agent:main' }]);
  });
  it('highlights Main with ✅ when activeLeadId is null (explicit main)', () => {
    const kb = buildAgentKeyboard([], { activeLeadId: null });
    assert.deepEqual(kb.inline_keyboard[0], [{ text: '✅ 🤖 Main', callback_data: 'agent:main' }]);
  });
});

describe('buildAgentKeyboard — active lead', () => {
  const leads = [
    { id: 'l1', label: 'Marie' },
    { id: 'l2', label: 'Paul' },
  ];

  it('shows Main without ✅ when a lead is active', () => {
    const kb = buildAgentKeyboard(leads, { activeLeadId: 'l1' });
    assert.deepEqual(kb.inline_keyboard[0], [{ text: '🤖 Main', callback_data: 'agent:main' }]);
  });

  it('highlights active lead with ✅', () => {
    const kb = buildAgentKeyboard(leads, { activeLeadId: 'l1' });
    assert.deepEqual(kb.inline_keyboard[1], [{ text: '✅ 👤 Marie', callback_data: 'agent:lead:l1' }]);
  });

  it('does not highlight inactive lead', () => {
    const kb = buildAgentKeyboard(leads, { activeLeadId: 'l1' });
    assert.deepEqual(kb.inline_keyboard[2], [{ text: '👤 Paul', callback_data: 'agent:lead:l2' }]);
  });
});

describe('buildAgentKeyboard — pagination', () => {
  const leads = Array.from({ length: AGENT_PAGE_SIZE + 3 }, (_, i) => ({ id: `l${i}`, label: `L${i}` }));

  it('shows only PAGE_SIZE leads on page 0', () => {
    const kb = buildAgentKeyboard(leads, { page: 0 });
    // 1 Main + PAGE_SIZE leads + 1 nav row
    assert.equal(kb.inline_keyboard.length, AGENT_PAGE_SIZE + 2);
  });

  it('adds ▶ nav button when more leads exist', () => {
    const kb = buildAgentKeyboard(leads, { page: 0 });
    const nav = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    assert.ok(nav.some((b) => b.callback_data === `agent:agent_pg:1`));
  });

  it('adds ◀ nav button on page 1', () => {
    const kb = buildAgentKeyboard(leads, { page: 1 });
    const nav = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    assert.ok(nav.some((b) => b.callback_data === `agent:agent_pg:0`));
  });

  it('shows no nav row when all leads fit on one page', () => {
    const small = leads.slice(0, AGENT_PAGE_SIZE - 1);
    const kb = buildAgentKeyboard(small);
    // 1 Main + (PAGE_SIZE-1) leads, no nav row
    assert.equal(kb.inline_keyboard.length, AGENT_PAGE_SIZE);
  });
});

// ─── buildLeadsKeyboard ────────────────────────────────────────────────────

describe('buildLeadsKeyboard', () => {
  const leads = Array.from({ length: AGENT_PAGE_SIZE + 2 }, (_, i) => ({ id: `l${i}`, label: `L${i}` }));

  it('each button uses agent:detail:<id> callback', () => {
    const kb = buildLeadsKeyboard([{ id: 'x1', label: 'Alice' }]);
    assert.deepEqual(kb.inline_keyboard[0], [{ text: '👤 Alice', callback_data: 'agent:detail:x1' }]);
  });

  it('paginates with agent:leads_pg:<status>:<n> callbacks', () => {
    const kb = buildLeadsKeyboard(leads, { page: 0, status: 'active' });
    const nav = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    assert.ok(nav.some((b) => b.callback_data === 'agent:leads_pg:active:1'));
  });

  it('uses "all" as status key when status is empty', () => {
    const kb = buildLeadsKeyboard(leads, { page: 0, status: '' });
    const nav = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    assert.ok(nav.some((b) => b.callback_data === 'agent:leads_pg:all:1'));
  });

  it('shows no nav row when leads fit on one page', () => {
    const kb = buildLeadsKeyboard([{ id: 'x1', label: 'Alice' }]);
    assert.equal(kb.inline_keyboard.length, 1);
  });
});

// ─── buildLeadPickerKeyboard ───────────────────────────────────────────────

describe('buildLeadPickerKeyboard', () => {
  const leads = Array.from({ length: AGENT_PAGE_SIZE + 1 }, (_, i) => ({ id: `l${i}`, label: `L${i}` }));

  it('each button uses agent:history:<id> callback', () => {
    const kb = buildLeadPickerKeyboard([{ id: 'y1', label: 'Bob' }]);
    assert.deepEqual(kb.inline_keyboard[0], [{ text: '👤 Bob', callback_data: 'agent:history:y1' }]);
  });

  it('paginates with agent:hist_pg:<n> callbacks', () => {
    const kb = buildLeadPickerKeyboard(leads, 0);
    const nav = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    assert.ok(nav.some((b) => b.callback_data === 'agent:hist_pg:1'));
  });

  it('back button present on page 1', () => {
    const kb = buildLeadPickerKeyboard(leads, 1);
    const nav = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    assert.ok(nav.some((b) => b.callback_data === 'agent:hist_pg:0'));
  });
});

// ─── formatAgentLabel ─────────────────────────────────────────────────────

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
