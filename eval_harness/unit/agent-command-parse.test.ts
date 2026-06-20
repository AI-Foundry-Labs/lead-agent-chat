import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentCommand, parseAgentCallback } from '../../lib/telegram/agent-command';

describe('parseAgentCommand', () => {
  it('returns not_command for plain text', () => {
    assert.deepEqual(parseAgentCommand('hello there'), { kind: 'not_command' });
  });
  it('returns show for bare /agent', () => {
    assert.deepEqual(parseAgentCommand('/agent'), { kind: 'show' });
    assert.deepEqual(parseAgentCommand('  /agent  '), { kind: 'show' });
  });
  it('returns set_main for /agent main', () => {
    assert.deepEqual(parseAgentCommand('/agent main'), { kind: 'set_main' });
  });
  it('returns set_lead with trimmed query for /agent lead <q>', () => {
    assert.deepEqual(parseAgentCommand('/agent lead Marie Dupont'), {
      kind: 'set_lead',
      query: 'Marie Dupont',
    });
  });
  it('returns show for /agent lead with no query', () => {
    assert.deepEqual(parseAgentCommand('/agent lead'), { kind: 'show' });
  });
});

describe('parseAgentCallback', () => {
  it('parses agent:main', () => {
    assert.deepEqual(parseAgentCallback('agent:main'), { kind: 'main' });
  });
  it('parses agent:lead:<id>', () => {
    assert.deepEqual(parseAgentCallback('agent:lead:abc-123'), { kind: 'lead', leadId: 'abc-123' });
  });
  it('parses agent:history:<id>', () => {
    assert.deepEqual(parseAgentCallback('agent:history:uuid-456'), { kind: 'history', leadId: 'uuid-456' });
  });
  it('parses agent:detail:<id>', () => {
    assert.deepEqual(parseAgentCallback('agent:detail:uuid-789'), { kind: 'detail', leadId: 'uuid-789' });
  });
  it('parses agent:agent_pg:<n>', () => {
    assert.deepEqual(parseAgentCallback('agent:agent_pg:2'), { kind: 'agent_pg', page: 2 });
  });
  it('parses agent:leads_pg:<status>:<n>', () => {
    assert.deepEqual(parseAgentCallback('agent:leads_pg:active:1'), {
      kind: 'leads_pg', status: 'active', page: 1,
    });
  });
  it('parses agent:leads_pg:all:<n> as empty status', () => {
    assert.deepEqual(parseAgentCallback('agent:leads_pg:all:0'), {
      kind: 'leads_pg', status: '', page: 0,
    });
  });
  it('parses agent:hist_pg:<n>', () => {
    assert.deepEqual(parseAgentCallback('agent:hist_pg:3'), { kind: 'hist_pg', page: 3 });
  });
  it('returns null for unrelated data', () => {
    assert.equal(parseAgentCallback('other:thing'), null);
  });
  it('returns null for empty string', () => {
    assert.equal(parseAgentCallback(''), null);
  });
});
