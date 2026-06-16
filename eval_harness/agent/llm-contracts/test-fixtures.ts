/**
 * Shared fixtures for LLM contract tests.
 * No DB, no LLM deps — pure in-memory data matching real types.
 */
import type { AgencyConfig, Lead, Listing } from '../../../lib/types.ts';

export const AGENCY_CONFIG: AgencyConfig = {
  id: 'cfg-test',
  agency_id: 'agency-test',
  name: 'Agence Lumière',
  tone: 'Professional and warm. Be concise and helpful.',
  qualification_criteria: [
    { key: 'budget',    label: 'Budget d\'achat',         hint: 'Fourchette en euros' },
    { key: 'timeline',  label: 'Horizon d\'achat',         hint: 'Dans combien de temps' },
    { key: 'financing', label: 'Mode de financement',      hint: 'Prêt bancaire ou comptant' },
  ],
  calendar_id: 'cal-test',
};

export const FIXTURE_LISTING: Listing = {
  id: 'lst-test',
  agency_id: 'agency-test',
  title: 'Appartement Marais — 3 pièces 72 m²',
  title_en: 'Marais Apartment — 3 rooms 72 m²',
  address: '12 rue de Bretagne, Paris 75003',
  price: 780000,
  surface_m2: 72,
  rooms: 3,
  floor: '3ème étage avec ascenseur',
  floor_en: '3rd floor with elevator',
  description: 'Bel appartement entièrement rénové, parquet, double vitrage, cuisine équipée.',
  description_en: 'Beautifully renovated apartment, hardwood floors, double glazing, fitted kitchen.',
  key_features: ['Parquet', 'Lumineux', 'Cuisine équipée', 'Ascenseur'],
  key_features_en: ['Hardwood floors', 'Bright', 'Fitted kitchen', 'Elevator'],
  image_url: null,
  agent_name: 'Marie Durand',
  agent_email: 'marie@agence-lumiere.fr',
  agent_calendar_id: 'cal-marie',
};

export const IDENTIFIED_LEAD: Lead = {
  id: 'lead-test-001',
  agency_id: 'agency-test',
  channel: 'web',
  email: 'tarik@example.com',
  name: 'Tarik',
  language: 'fr',
  status: 'active',
  qual_values: { budget: '750k€' },
  potential_status: 'warm',
  score_reason: 'Stated budget, actively browsing',
  long_term_memory: null,
  persona: null,
  listing_id: 'lst-test',
  telegram_user_id: null,
  anon_seq: null,
  created_at: new Date('2026-06-01T00:00:00Z'),
  updated_at: new Date('2026-06-14T00:00:00Z'),
};

export const ANON_LEAD: Lead = {
  ...IDENTIFIED_LEAD,
  id: 'lead-test-anon',
  email: null,
  name: null,
  qual_values: {},
  potential_status: null,
  score_reason: null,
};

// Two future ISO slots (used as mock get_available_slots output)
export const FIXTURE_SLOTS = [
  { iso: '2026-06-20T08:00:00.000Z', label: 'Vendredi 20 juin — 10h00' },
  { iso: '2026-06-20T12:00:00.000Z', label: 'Vendredi 20 juin — 14h00' },
  { iso: '2026-06-23T08:00:00.000Z', label: 'Lundi 23 juin — 10h00' },
];
