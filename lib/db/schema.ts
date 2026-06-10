import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  index
} from 'drizzle-orm/pg-core';

// A criterion definition lives in agency_config; the lead's answers are stored
// as a free-form key→value map (qual_values) so the criteria set is admin-owned.
export type Criterion = { key: string; label: string; hint?: string };

// ─── Conversations (first-class, replaces the implicit lead↔messages 1:1) ──
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: varchar('type', { length: 24 }).notNull(), // lead | operator | main_assistant
    lead_id: uuid('lead_id'), // null while anonymous; null operator = anonymous pool
    admin_id: uuid('admin_id'), // set for main_assistant
    listing_id: varchar('listing_id', { length: 50 }), // the property under discussion
    primary_channel: varchar('primary_channel', { length: 10 })
      .default('web')
      .notNull(), // 'web' | 'email' | 'telegram'
    mode: varchar('mode', { length: 10 }).default('agent').notNull(), // 'agent' | 'manual'
    // Short-term memory: rolled summary of older turns in this thread (see lib/agent/thread-memory.ts).
    thread_summary: text('thread_summary'),
    summarized_turn_count: integer('summarized_turn_count').default(0).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => ({
    lead_idx: index('conversations_lead_idx').on(t.lead_id),
    admin_idx: index('conversations_admin_idx').on(t.admin_id),
    updated_idx: index('conversations_updated_idx').on(t.updated_at)
  })
);

// ─── Messages (hang off conversation_id; gain tool transparency) ───────────
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversation_id: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 12 }).notNull(), // 'user' | 'assistant' | 'admin' | 'tool'
    content: text('content').notNull(),
    tool_calls: jsonb('tool_calls'), // what the agent invoked this turn
    tool_results: jsonb('tool_results'),
    is_draft: boolean('is_draft').default(false).notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => ({
    conv_idx: index('messages_conversation_idx').on(t.conversation_id)
  })
);

// ─── Leads (qualification generalised to an admin-owned criteria set) ──────
export const leads = pgTable('leads', {
  id: uuid('id').defaultRandom().primaryKey(),
  channel: varchar('channel', { length: 10 }).default('web').notNull(),
  // Null while the visitor is anonymous; captured at contact/login or booking.
  email: varchar('email', { length: 255 }),
  name: varchar('name', { length: 255 }),
  listing_id: varchar('listing_id', { length: 50 }),
  language: varchar('language', { length: 5 }).default('fr').notNull(),
  status: varchar('status', { length: 30 }).default('active').notNull(),
  qual_values: jsonb('qual_values')
    .$type<Record<string, string>>()
    .default({})
    .notNull(),
  potential_status: varchar('potential_status', { length: 10 }), // 'hot' | 'warm' | 'cold'
  score_reason: text('score_reason'),
  // Cross-thread visitor memory (modest cap enforced in app layer).
  long_term_memory: text('long_term_memory'),
  // Set when the visitor links Telegram via /start <token> from the site.
  telegram_user_id: varchar('telegram_user_id', { length: 50 }),
  created_at: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
});

// ─── Viewing slots (booking record produced by the book_viewing tool) ──────
export const viewing_slots = pgTable('viewing_slots', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversation_id: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  lead_id: uuid('lead_id'),
  listing_id: varchar('listing_id', { length: 50 }).notNull(),
  contact_email: varchar('contact_email', { length: 255 }),
  proposed_slots: jsonb('proposed_slots').$type<string[]>().default([]).notNull(),
  confirmed_slot: timestamp('confirmed_slot', { withTimezone: true }),
  status: varchar('status', { length: 20 }).default('proposed').notNull(), // 'proposed' | 'booked' | 'cancelled'
  calendar_event_id: varchar('calendar_event_id', { length: 255 }),
  summary: text('summary'),
  created_at: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull()
});

// ─── Agency config (criteria are now {key,label,hint} objects) ─────────────
export const agency_config = pgTable('agency_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  tone: text('tone').notNull(),
  qualification_criteria: jsonb('qualification_criteria')
    .$type<Criterion[]>()
    .notNull(),
  calendar_id: varchar('calendar_id', { length: 255 }).notNull()
});

export const listings = pgTable('listings', {
  id: varchar('id', { length: 50 }).primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  title_en: varchar('title_en', { length: 255 }).notNull(),
  address: varchar('address', { length: 500 }).notNull(),
  price: integer('price').notNull(),
  surface_m2: integer('surface_m2').notNull(),
  rooms: integer('rooms').notNull(),
  floor: varchar('floor', { length: 255 }).notNull(),
  floor_en: varchar('floor_en', { length: 255 }).notNull(),
  description: text('description').notNull(),
  description_en: text('description_en').notNull(),
  key_features: jsonb('key_features').$type<string[]>().notNull(),
  key_features_en: jsonb('key_features_en').$type<string[]>().notNull(),
  image_url: varchar('image_url', { length: 1000 }),
  agent_name: varchar('agent_name', { length: 255 }).notNull(),
  agent_email: varchar('agent_email', { length: 255 }).notNull(),
  agent_calendar_id: varchar('agent_calendar_id', { length: 255 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const handoff_rules = pgTable('handoff_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  description: text('description').notNull(),
  trigger_keywords: jsonb('trigger_keywords').$type<string[]>().notNull(),
  active: boolean('active').default(true).notNull(),
  created_at: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const admins = pgTable('admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password_hash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  telegram_user_id: varchar('telegram_user_id', { length: 50 }),
  created_at: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  last_login_at: timestamp('last_login_at', { withTimezone: true })
});

export const admin_sessions = pgTable(
  'admin_sessions',
  {
    token_hash: varchar('token_hash', { length: 64 }).primaryKey(),
    admin_id: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    user_agent: varchar('user_agent', { length: 500 }),
    ip: varchar('ip', { length: 45 })
  },
  (t) => ({
    admin_idx: index('admin_sessions_admin_idx').on(t.admin_id),
    expires_idx: index('admin_sessions_expires_idx').on(t.expires_at)
  })
);

export const lead_sessions = pgTable(
  'lead_sessions',
  {
    token_hash: varchar('token_hash', { length: 64 }).primaryKey(),
    lead_id: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    user_agent: varchar('user_agent', { length: 500 }),
    ip: varchar('ip', { length: 45 })
  },
  (t) => ({
    lead_idx: index('lead_sessions_lead_idx').on(t.lead_id),
    expires_idx: index('lead_sessions_expires_idx').on(t.expires_at)
  })
);

export const lead_magic_links = pgTable(
  'lead_magic_links',
  {
    token_hash: varchar('token_hash', { length: 64 }).primaryKey(),
    lead_id: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed_at: timestamp('consumed_at', { withTimezone: true })
  },
  (t) => ({
    lead_idx: index('lead_magic_links_lead_idx').on(t.lead_id),
    expires_idx: index('lead_magic_links_expires_idx').on(t.expires_at)
  })
);

// ─── Lead Telegram link tokens (visitor /start <token> from site deep link) ──
export const lead_telegram_link_tokens = pgTable(
  'lead_telegram_link_tokens',
  {
    token_hash: varchar('token_hash', { length: 64 }).primaryKey(),
    conversation_id: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    lead_id: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    listing_id: varchar('listing_id', { length: 50 }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed_at: timestamp('consumed_at', { withTimezone: true })
  },
  (t) => ({
    conv_idx: index('lead_telegram_link_tokens_conv_idx').on(t.conversation_id),
    expires_idx: index('lead_telegram_link_tokens_expires_idx').on(t.expires_at)
  })
);

// ─── Telegram link tokens (admin /start <token> binding) ───────────────────
export const telegram_link_tokens = pgTable(
  'telegram_link_tokens',
  {
    token_hash: varchar('token_hash', { length: 64 }).primaryKey(),
    admin_id: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed_at: timestamp('consumed_at', { withTimezone: true })
  },
  (t) => ({
    admin_idx: index('telegram_link_tokens_admin_idx').on(t.admin_id),
    expires_idx: index('telegram_link_tokens_expires_idx').on(t.expires_at)
  })
);
