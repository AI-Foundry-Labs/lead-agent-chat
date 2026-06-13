/**
 * Tests for buildLeadSystemPrompt — verifies that the system prompt is constructed
 * correctly for each conversation context (anonymous, identified, booking, language).
 *
 * These tests catch regressions in prompt logic without an LLM call.
 * Import is direct — prompts.ts has no Next.js or DB dependencies.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadSystemPrompt } from '../../../lib/agent/prompts.ts';
import type { AgencyConfig, Lead, Listing } from '../../../lib/types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_CONFIG: AgencyConfig = {
  id: 'cfg1',
  agency_id: 'agency-1',
  name: 'Agence Lumière',
  tone: 'Professional and warm.',
  calendar_id: 'cal1',
  qualification_criteria: [
    { key: 'budget',   label: 'Budget',    hint: 'max price in €' },
    { key: 'timeline', label: 'Timeline',  hint: 'when ready to move' },
    { key: 'financing',label: 'Financing', hint: 'cash or mortgage' }
  ]
};

const LISTING: Listing = {
  id: 'lst1',
  agency_id: 'agency-1',
  title: 'Appartement 3 pièces — Le Marais',
  title_en: '3-room apartment — Le Marais',
  address: '14 rue de Bretagne, 75004 Paris',
  price: 650000,
  surface_m2: 72,
  rooms: 3,
  floor: '3ème étage',
  floor_en: '3rd floor',
  description: 'Bel appartement lumineux.',
  description_en: 'Beautiful bright apartment.',
  key_features: ['Parquet', 'Double vitrage'],
  key_features_en: ['Hardwood floors', 'Double glazing'],
  image_url: null,
  agent_name: 'Camille Laurent',
  agent_email: 'camille@agence.fr',
  agent_calendar_id: 'cal-agent-1'
};

const ANON_LEAD: Lead | null = null;

const IDENTIFIED_LEAD: Lead = {
  id: 'l1',
  agency_id: 'agency-1',
  channel: 'web',
  language: 'fr',
  email: 'tarik@example.com',
  name: 'Tarik',
  status: 'active',
  potential_status: 'warm',
  qual_values: { budget: '650k€' },
  score_reason: null,
  long_term_memory: null,
  listing_id: 'lst1',
  telegram_user_id: null,
  created_at: new Date(),
  updated_at: new Date()
};

const BOOKED_LEAD: Lead = {
  ...IDENTIFIED_LEAD,
  status: 'booked',
  qual_values: { budget: '650k€', timeline: '3 months', financing: 'mortgage' }
};

// ── Language block ─────────────────────────────────────────────────────────────

describe('Language rules block', () => {
  it('sets defaultLang to French when lang=fr', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: null, lang: 'fr' });
    assert.ok(prompt.includes('Default language for this conversation: French'));
    assert.ok(prompt.includes('ONLY reply in English or French'));
  });

  it('sets defaultLang to English when lang=en', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: null, lang: 'en' });
    assert.ok(prompt.includes('Default language for this conversation: English'));
  });

  it('language block appears at very top of prompt', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: null, lang: 'fr' });
    const criticalIdx = prompt.indexOf('[CRITICAL — LANGUAGE]');
    const roleIdx = prompt.indexOf('[ROLE]');
    assert.ok(criticalIdx < roleIdx, 'Language block must precede ROLE block');
    assert.ok(criticalIdx === 0, 'Language block should be the very first content');
  });

  it('includes fallback-to-defaultLang rule for non-EN/FR visitors', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: null, lang: 'fr' });
    assert.ok(prompt.includes('any other language'));
    // Should tell model to reply in defaultLang, not the visitor's language
    assert.ok(prompt.match(/reply\s+in\s+French/i) || prompt.includes('reply\n  in French'));
  });
});

// ── Visitor identity block ─────────────────────────────────────────────────────

describe('Visitor identity block', () => {
  it('shows CONTACT CAPTURE instructions for anonymous visitor', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: ANON_LEAD, lang: 'fr' });
    assert.ok(prompt.includes('CONTACT CAPTURE'), 'anonymous visitor should show contact capture block');
    assert.ok(prompt.includes('book_viewing REQUIRES an email'));
  });

  it('shows email and name for identified visitor', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: IDENTIFIED_LEAD, lang: 'fr' });
    assert.ok(prompt.includes('tarik@example.com'), 'should include lead email');
    assert.ok(prompt.includes('Tarik'), 'should include lead name');
  });

  it('does NOT show CONTACT CAPTURE block for identified visitor', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: IDENTIFIED_LEAD, lang: 'fr' });
    assert.ok(!prompt.includes('CONTACT CAPTURE'), 'identified visitor should not see contact capture block');
  });

  it('tells agent not to re-ask for email when already on file', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: IDENTIFIED_LEAD, lang: 'fr' });
    assert.ok(prompt.includes('Do not ask for their email again'));
  });
});

// ── Listing context block ──────────────────────────────────────────────────────

describe('Listing context block', () => {
  it('includes property details when listing provided', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: null, lang: 'fr' });
    assert.ok(prompt.includes('Appartement 3 pièces — Le Marais'));
    assert.ok(prompt.includes('14 rue de Bretagne'));
    assert.ok(prompt.includes('650'));
    assert.ok(prompt.includes('72 m²'));
  });

  it('uses English listing fields when lang=en', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: null, lang: 'en' });
    assert.ok(prompt.includes('3-room apartment — Le Marais'), 'should use title_en');
    assert.ok(prompt.includes('Hardwood floors'), 'should use key_features_en');
    assert.ok(prompt.includes('3rd floor'), 'should use floor_en');
  });

  it('uses French listing fields when lang=fr', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: null, lang: 'fr' });
    assert.ok(prompt.includes('Appartement 3 pièces'), 'should use French title');
    assert.ok(prompt.includes('Parquet'), 'should use French key_features');
  });

  it('shows browsing fallback when no listing', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: null, lang: 'fr' });
    assert.ok(prompt.includes('No specific property selected'));
  });
});

// ── Qualification criteria block ───────────────────────────────────────────────

describe('Qualification criteria block', () => {
  it('shows all criteria as not yet collected for anonymous lead', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: ANON_LEAD, lang: 'fr' });
    assert.ok(prompt.includes('budget'));
    assert.ok(prompt.includes('timeline'));
    assert.ok(prompt.includes('financing'));
    assert.ok(prompt.includes('not yet collected'));
  });

  it('shows collected criteria values for identified lead', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: IDENTIFIED_LEAD, lang: 'fr' });
    assert.ok(prompt.includes('budget') && prompt.includes('650k€'), 'collected budget should appear');
  });

  it('shows still-needed criteria for partially qualified lead', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: IDENTIFIED_LEAD, lang: 'fr' });
    assert.ok(prompt.includes('Still needed:'));
    assert.ok(prompt.includes('timeline'), 'missing timeline should appear in still-needed');
    assert.ok(prompt.includes('financing'), 'missing financing should appear in still-needed');
  });

  it('shows "nothing" for still-needed when all criteria collected', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: BOOKED_LEAD, lang: 'fr' });
    assert.ok(prompt.includes('nothing — all criteria collected'));
  });
});

// ── Tool instructions block ────────────────────────────────────────────────────

describe('Tool instructions block', () => {
  it('includes CRITICAL slot_iso instruction', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: null, lang: 'fr' });
    assert.ok(prompt.includes('slot_iso'), 'must include slot_iso instruction');
    assert.ok(prompt.includes('exact "iso" field'), 'must emphasize exact iso usage');
  });

  it('includes TOOL CALL DISCIPLINE block', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: null, lang: 'fr' });
    assert.ok(prompt.includes('TOOL CALL DISCIPLINE'));
    assert.ok(prompt.includes('SILENTLY'));
  });

  it('includes RESPONSE COMPLETENESS block', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: null, lang: 'fr' });
    assert.ok(prompt.includes('RESPONSE COMPLETENESS'));
  });

  it('does NOT include finish_reply reference (removed from architecture)', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: LISTING, lead: null, lang: 'fr' });
    assert.ok(!prompt.includes('finish_reply'), 'finish_reply was removed — must not appear in prompt');
  });
});

// ── Channel block ──────────────────────────────────────────────────────────────

describe('Channel block', () => {
  it('shows Telegram offer for web channel', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: null, lang: 'fr', channel: 'web' });
    assert.ok(prompt.includes('CHANNEL — WEB'));
    assert.ok(prompt.includes('suggest_telegram_chat'));
  });

  it('shows Telegram channel instructions for telegram channel', () => {
    const prompt = buildLeadSystemPrompt({ config: BASE_CONFIG, listing: null, lead: null, lang: 'fr', channel: 'telegram' });
    assert.ok(prompt.includes('CHANNEL — TELEGRAM'));
    assert.ok(prompt.includes('SEPARATE chat session'));
  });
});
