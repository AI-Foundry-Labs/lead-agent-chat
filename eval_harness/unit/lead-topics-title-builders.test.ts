/**
 * Unit tests for pure title builder functions from lib/telegram/lead-topics.ts
 *
 * Tests the lead display name fallback chain and topic title formatting:
 * - buildLeadDisplayName: name → email local-part → "Visiteur"
 * - buildConversationTopicTitle: "💬 {leadName} — {listing}" or "💬 {leadName}"
 * - buildAssistantTopicTitle: "🤖 {leadName} — Assistant"
 *
 * No DB, no Telegram API calls. Pure string logic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeadDisplayName,
  buildConversationTopicTitle,
  buildAssistantTopicTitle
} from '../../lib/telegram/lead-topics';

describe('buildLeadDisplayName', () => {
  describe('uses name when provided', () => {
    it('returns name as-is when provided', () => {
      const result = buildLeadDisplayName('Alice Smith', 'alice@example.com');
      assert.equal(result, 'Alice Smith');
    });

    it('trims whitespace from name', () => {
      const result = buildLeadDisplayName('  Bob Jones  ', 'bob@example.com');
      assert.equal(result, 'Bob Jones');
    });

    it('returns name even if email is missing', () => {
      const result = buildLeadDisplayName('Charlie', null);
      assert.equal(result, 'Charlie');
    });
  });

  describe('falls back to email local-part when name is missing', () => {
    it('extracts local-part from valid email', () => {
      const result = buildLeadDisplayName(null, 'david@example.com');
      assert.equal(result, 'david');
    });

    it('handles emails with multiple dots in domain', () => {
      const result = buildLeadDisplayName(undefined, 'eve@mail.co.uk');
      assert.equal(result, 'eve');
    });

    it('falls back to Visiteur if no @ in email', () => {
      const result = buildLeadDisplayName(null, 'notanemail');
      assert.equal(result, 'Visiteur');
    });

    it('returns empty string before @ if email starts with @', () => {
      const result = buildLeadDisplayName(null, '@example.com');
      assert.equal(result, '');
    });
  });

  describe('falls back to "Visiteur" when name and email both missing', () => {
    it('returns Visiteur when name and email are null', () => {
      const result = buildLeadDisplayName(null, null);
      assert.equal(result, 'Visiteur');
    });

    it('returns Visiteur when name and email are undefined', () => {
      const result = buildLeadDisplayName(undefined, undefined);
      assert.equal(result, 'Visiteur');
    });

    it('returns Visiteur when name is empty string', () => {
      const result = buildLeadDisplayName('', 'contact@example.com');
      assert.equal(result, 'contact');
    });

    it('returns Visiteur when name is whitespace-only', () => {
      const result = buildLeadDisplayName('   ', null);
      assert.equal(result, 'Visiteur');
    });
  });

  describe('fallback chain precedence', () => {
    it('name takes precedence over email', () => {
      const result = buildLeadDisplayName('John', 'jane@example.com');
      assert.equal(result, 'John');
    });

    it('email local-part takes precedence over Visiteur', () => {
      const result = buildLeadDisplayName(null, 'visitor@example.com');
      assert.equal(result, 'visitor');
    });

    it('full chain: name provided (skips email and Visiteur)', () => {
      const result = buildLeadDisplayName('NameProvided', 'email@example.com');
      assert.equal(result, 'NameProvided');
    });
  });
});

describe('buildConversationTopicTitle', () => {
  describe('formats title with emoji and listing', () => {
    it('includes emoji, lead name, and listing title', () => {
      const result = buildConversationTopicTitle('Marie D.', 'Marais 2BR');
      assert.equal(result, '💬 Marie D. — Marais 2BR');
    });

    it('omits listing when not provided', () => {
      const result = buildConversationTopicTitle('Marie D.', null);
      assert.equal(result, '💬 Marie D.');
    });

    it('omits listing when undefined', () => {
      const result = buildConversationTopicTitle('John', undefined);
      assert.equal(result, '💬 John');
    });

    it('trims whitespace from listing title', () => {
      const result = buildConversationTopicTitle('Marie D.', '  Marais 2BR  ');
      assert.equal(result, '💬 Marie D. — Marais 2BR');
    });

    it('omits listing if it becomes empty after trim', () => {
      const result = buildConversationTopicTitle('Marie D.', '   ');
      assert.equal(result, '💬 Marie D.');
    });

    it('handles special characters in lead name', () => {
      const result = buildConversationTopicTitle('François Müller', 'Café Studio');
      assert.equal(result, '💬 François Müller — Café Studio');
    });

    it('handles empty string lead name', () => {
      const result = buildConversationTopicTitle('', 'Some Property');
      assert.equal(result, '💬  — Some Property');
    });
  });
});

describe('buildAssistantTopicTitle', () => {
  describe('formats title consistently', () => {
    it('includes emoji, lead name, and Assistant suffix', () => {
      const result = buildAssistantTopicTitle('Marie D.');
      assert.equal(result, '🤖 Marie D. — Assistant');
    });

    it('works with empty string', () => {
      const result = buildAssistantTopicTitle('');
      assert.equal(result, '🤖  — Assistant');
    });

    it('works with special characters', () => {
      const result = buildAssistantTopicTitle('François Müller');
      assert.equal(result, '🤖 François Müller — Assistant');
    });

    it('preserves lead name as-is (does not trim)', () => {
      const result = buildAssistantTopicTitle('  Visitor  ');
      assert.equal(result, '🤖   Visitor   — Assistant');
    });
  });
});

describe('title builder integration', () => {
  it('produces consistent topics for a lead', () => {
    const displayName = buildLeadDisplayName('Alice', 'alice@example.com');
    const convTitle = buildConversationTopicTitle(displayName, 'Central Park Studio');
    const asstTitle = buildAssistantTopicTitle(displayName);

    assert.equal(displayName, 'Alice');
    assert.equal(convTitle, '💬 Alice — Central Park Studio');
    assert.equal(asstTitle, '🤖 Alice — Assistant');
  });

  it('handles full fallback chain: no name, email provided, listing provided', () => {
    const displayName = buildLeadDisplayName(null, 'contact@property.fr');
    const convTitle = buildConversationTopicTitle(displayName, '3ème arr. 1BR');
    const asstTitle = buildAssistantTopicTitle(displayName);

    assert.equal(displayName, 'contact');
    assert.equal(convTitle, '💬 contact — 3ème arr. 1BR');
    assert.equal(asstTitle, '🤖 contact — Assistant');
  });

  it('handles full fallback chain: no name, no email, no listing', () => {
    const displayName = buildLeadDisplayName(null, null);
    const convTitle = buildConversationTopicTitle(displayName, null);
    const asstTitle = buildAssistantTopicTitle(displayName);

    assert.equal(displayName, 'Visiteur');
    assert.equal(convTitle, '💬 Visiteur');
    assert.equal(asstTitle, '🤖 Visiteur — Assistant');
  });
});
