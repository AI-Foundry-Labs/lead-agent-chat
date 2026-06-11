/**
 * Unit tests for toModelMessages empty-content filtering.
 * Verifies BUG-001 fix: empty assistant messages no longer corrupt context.
 * Logic inlined from lib/agent/thread-memory.ts and lib/agent/run.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

type RawMsg = { role: string; content: string };
type ModelMsg = { role: 'user' | 'assistant'; content: string };

// Inline the fixed toModelMessages (matches both run.ts and thread-memory.ts)
function toModelMessages(msgs: RawMsg[]): ModelMsg[] {
  return msgs
    .filter((m) => m.role !== 'tool' && m.content.trim() !== '')
    .map((m) => ({
      role: (m.role === 'user' || m.role === 'system') ? 'user' : 'assistant',
      content: m.content
    }));
}

describe('toModelMessages — empty content filtering', () => {
  it('removes empty assistant messages', () => {
    const msgs: RawMsg[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '' },      // ← previously broke context
      { role: 'user', content: 'Still there?' }
    ];
    const result = toModelMessages(msgs);
    assert.equal(result.length, 2);
    assert.equal(result[0].content, 'Hello');
    assert.equal(result[1].content, 'Still there?');
  });

  it('removes whitespace-only messages', () => {
    const msgs: RawMsg[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: '   \n  ' }
    ];
    const result = toModelMessages(msgs);
    assert.equal(result.length, 1);
  });

  it('filters tool-role messages', () => {
    const msgs: RawMsg[] = [
      { role: 'user', content: 'Book it' },
      { role: 'tool', content: '{"ok":true}' },
      { role: 'assistant', content: 'Done!' }
    ];
    const result = toModelMessages(msgs);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map(m => m.role), ['user', 'assistant']);
  });

  it('maps system role to user for LLM transcript', () => {
    const msgs: RawMsg[] = [
      { role: 'system', content: '[Handoff alert] Visitor mentioned price negotiation' },
      { role: 'assistant', content: 'Understood, escalating.' }
    ];
    const result = toModelMessages(msgs);
    assert.equal(result[0].role, 'user');
    assert.equal(result[1].role, 'assistant');
  });

  it('preserves non-empty assistant messages intact', () => {
    const msgs: RawMsg[] = [
      { role: 'user', content: 'What is the price?' },
      { role: 'assistant', content: 'The price is 650 000 €.' },
      { role: 'user', content: 'Can I visit?' },
      { role: 'assistant', content: 'Of course! Here are the slots.' }
    ];
    const result = toModelMessages(msgs);
    assert.equal(result.length, 4);
    assert.deepEqual(result.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  });

  it('handles multiple consecutive empty assistant messages (cascade scenario)', () => {
    // Scenario: 3 failed turns in a row stored empty strings
    const msgs: RawMsg[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'Hello?' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'Anyone there?' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'Last try' }
    ];
    const result = toModelMessages(msgs);
    // Only user messages survive — no empty assistants to corrupt context
    assert.equal(result.length, 4);
    assert.ok(result.every(m => m.role === 'user'));
  });
});

describe('empty reply fallback logic', () => {
  function buildStoredContent(reply: string, lang: 'en' | 'fr'): string {
    return reply.trim()
      ? reply
      : lang === 'en'
        ? "I'm sorry, I encountered an issue. Could you please repeat your message?"
        : "Je suis désolé, une erreur est survenue. Pourriez-vous répéter votre message ?";
  }

  it('returns reply as-is when non-empty', () => {
    const result = buildStoredContent('Bonjour!', 'fr');
    assert.equal(result, 'Bonjour!');
  });

  it('returns French fallback for empty reply in fr context', () => {
    const result = buildStoredContent('', 'fr');
    assert.ok(result.includes('désolé'));
    assert.ok(result.trim().length > 0);
  });

  it('returns English fallback for empty reply in en context', () => {
    const result = buildStoredContent('', 'en');
    assert.ok(result.includes("I'm sorry"));
    assert.ok(result.trim().length > 0);
  });

  it('treats whitespace-only reply as empty', () => {
    const result = buildStoredContent('   ', 'en');
    assert.ok(result.includes("I'm sorry"));
  });
});
