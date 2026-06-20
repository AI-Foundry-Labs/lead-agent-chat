import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  index,
  unique
} from 'drizzle-orm/pg-core';

// A criterion definition lives in agency_config; the lead's answers are stored
// as a free-form key→value map (qual_values) so the criteria set is admin-owned.
export type Criterion = { key: string; label: string; hint?: string };

// ─── Agencies (tenant root) ────────────────────────────────────────────────
// primary_host: the canonical hostname for this agency (e.g. "foncia.app.com").
// Used by middleware Host→agency resolution. v1 supports one domain per agency;
// add an agency_domains table in a future phase if multiple domains are needed.
//
// MIGRATION NOTE (existing databases):
//   Since this project uses drizzle-kit push (no SQL migration files), the safe
//   apply order for an EXISTING database with rows is:
//   1. Run `db:push` with agency_id columns defined as nullable (temporary).
//   2. Run `npx tsx scripts/migrate-add-agency.ts` to insert default agency and
//      backfill all agency_id = <default> WHERE agency_id IS NULL.
//   3. Run `db:push` again with agency_id columns as NOT NULL (final state here).
//   For a FRESH database: `db:push` + `db:seed` is sufficient (seed creates the
//   default agency and all rows get agency_id from the start).
export const agencies = pgTable('agencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  // Primary hostname for Host→agency routing (e.g. "acme.example.com").
  // Nullable: unset = not accessible by host (default agency fallback only).
  primary_host: varchar('primary_host', { length: 255 }).unique(),
  // Reserved for Phase 02: Telegram supergroup forum chat id.
  telegram_group_chat_id: varchar('telegram_group_chat_id', { length: 50 }).unique(),
  // Reserved for Phase 03: topic-per-lead mode.
  telegram_topics_enabled: boolean('telegram_topics_enabled').default(false).notNull(),
  // Phase 01 (master topic): message_thread_id of the 🛠 Master forum topic.
  // Null until the group is linked and the topic is created.
  telegram_master_topic_id: integer('telegram_master_topic_id'),
  // Per-agency counter for anonymous (not-logged-in) visitor sequence numbers.
  // Incremented atomically when an anonymous visitor is promoted to a lead so
  // their Telegram topic gets a readable label (e.g. "Visiteur #18").
  anon_seq_counter: integer('anon_seq_counter').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// ─── Conversations (first-class, replaces the implicit lead↔messages 1:1) ──
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // agency_id: denormalized from lead for fast per-agency scoped queries.
    // Single writer: set at conversation creation (same tx as lead creation).
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
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
    updated_idx: index('conversations_updated_idx').on(t.updated_at),
    agency_idx: index('conversations_agency_idx').on(t.agency_id)
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
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
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
    // Per-agency sequence number assigned when an anonymous visitor is promoted
    // to a lead (for readable Telegram topic titles). Null for identified leads.
    anon_seq: integer('anon_seq'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => ({
    agency_idx: index('leads_agency_idx').on(t.agency_id)
  })
);

// ─── Viewing slots (booking record produced by the book_viewing tool) ──────
export const viewing_slots = pgTable(
  'viewing_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
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
  },
  (t) => ({
    agency_idx: index('viewing_slots_agency_idx').on(t.agency_id)
  })
);

// ─── Agency config (criteria are now {key,label,hint} objects) ─────────────
// Unique on agency_id: one config row per agency.
export const agency_config = pgTable(
  'agency_config',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    name: varchar('name', { length: 255 }).notNull(),
    tone: text('tone').notNull(),
    qualification_criteria: jsonb('qualification_criteria')
      .$type<Criterion[]>()
      .notNull(),
    calendar_id: varchar('calendar_id', { length: 255 }).notNull()
  },
  (t) => ({
    agency_unique: unique('agency_config_agency_id_unique').on(t.agency_id)
  })
);

export const listings = pgTable(
  'listings',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
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
  },
  (t) => ({
    agency_idx: index('listings_agency_idx').on(t.agency_id)
  })
);

export const handoff_rules = pgTable(
  'handoff_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    description: text('description').notNull(),
    trigger_keywords: jsonb('trigger_keywords').$type<string[]>().notNull(),
    active: boolean('active').default(true).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => ({
    agency_idx: index('handoff_rules_agency_idx').on(t.agency_id)
  })
);

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    email: varchar('email', { length: 255 }).notNull().unique(),
    password_hash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    telegram_user_id: varchar('telegram_user_id', { length: 50 }),
    preferred_lang: varchar('preferred_lang', { length: 2 }).default('fr').notNull(),
    // How the bot should address / interact with this admin (tone, style, context).
    persona: text('persona'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    last_login_at: timestamp('last_login_at', { withTimezone: true })
  },
  (t) => ({
    agency_idx: index('admins_agency_idx').on(t.agency_id)
  })
);

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

// ─── Agency Telegram group link tokens (admin sends /link <token> IN the group) ─
// Single-use, 10-min TTL. Scoped to agency_id (not admin). Consumed atomically.
export const agency_telegram_link_tokens = pgTable(
  'agency_telegram_link_tokens',
  {
    token_hash: varchar('token_hash', { length: 64 }).primaryKey(),
    agency_id: uuid('agency_id')
      .notNull()
      .references(() => agencies.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed_at: timestamp('consumed_at', { withTimezone: true })
  },
  (t) => ({
    agency_idx: index('agency_telegram_link_tokens_agency_idx').on(t.agency_id),
    expires_idx: index('agency_telegram_link_tokens_expires_idx').on(t.expires_at)
  })
);

// ─── Lead Telegram topics (forum topic mapping per lead per agency group) ────
// Maps one lead → two forum topics (conversation + assistant) in an agency group.
// Unique on (group_chat_id, lead_id): idempotent, no duplicate pairs.
// Indexes on (group_chat_id, conversation_topic_id) and (group_chat_id, assistant_topic_id)
// support Phase 04 reverse routing by thread id.
export const lead_telegram_topics = pgTable(
  'lead_telegram_topics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    lead_id: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    group_chat_id: varchar('group_chat_id', { length: 50 }).notNull(),
    // Telegram message_thread_id of the 💬 Conversation topic
    conversation_topic_id: integer('conversation_topic_id').notNull(),
    // Telegram message_thread_id of the 🤖 Assistant topic
    assistant_topic_id: integer('assistant_topic_id').notNull(),
    // Corresponding conversation row ids for message dispatch
    lead_conversation_id: uuid('lead_conversation_id').references(() => conversations.id),
    operator_conversation_id: uuid('operator_conversation_id').references(() => conversations.id),
    status: varchar('status', { length: 20 }).default('open').notNull(), // 'open' | 'closed'
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (t) => ({
    // Idempotency guard: one topic pair per lead per group
    group_lead_unique: unique('lead_telegram_topics_group_lead_unique').on(
      t.group_chat_id,
      t.lead_id
    ),
    // Phase 04 reverse routing: resolve lead from inbound topic thread id
    conv_topic_idx: index('lead_telegram_topics_conv_topic_idx').on(
      t.group_chat_id,
      t.conversation_topic_id
    ),
    asst_topic_idx: index('lead_telegram_topics_asst_topic_idx').on(
      t.group_chat_id,
      t.assistant_topic_id
    ),
    agency_idx: index('lead_telegram_topics_agency_idx').on(t.agency_id)
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

// ─── Telegram agent hub session (one active subagent per agency) ────────────
// agent_kind='main' → main-assistant; agent_kind='operator' → operator for lead_id.
export const telegram_agent_sessions = pgTable('telegram_agent_sessions', {
  agency_id: uuid('agency_id')
    .primaryKey()
    .references(() => agencies.id, { onDelete: 'cascade' }),
  agent_kind: varchar('agent_kind', { length: 20 }).notNull(), // 'main' | 'operator'
  lead_id: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// ─── Message templates (F4b — agency-owned reusable message bodies) ─────────
// Templates carry {{placeholder}} tokens (whitelist: name/email/listing_title/
// agency_name) filled at render time. Agency-scoped config, not per-lead.
export const message_templates = pgTable(
  'message_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => ({
    agency_idx: index('message_templates_agency_idx').on(t.agency_id)
  })
);

// ─── Lead consents (F4d — GDPR/CNIL data-processing consent, append-only) ────
// Each grant/withdrawal is a new row; current state = latest row per (lead, type).
// Cascades on lead delete so erasure removes consent PII too.
export const lead_consents = pgTable(
  'lead_consents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    lead_id: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    consent_type: varchar('consent_type', { length: 20 }).notNull(), // data_processing | marketing | phone_contact
    granted: boolean('granted').notNull(),
    source: varchar('source', { length: 50 }), // e.g. 'phone', 'web_form', 'email'
    recorded_by: uuid('recorded_by'), // admin id (nullable — may be system)
    notes: text('notes'),
    recorded_at: timestamp('recorded_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => ({
    lead_idx: index('lead_consents_lead_idx').on(t.agency_id, t.lead_id)
  })
);

// ─── Audit log (F4d — who accessed/modified a lead and when) ─────────────────
// target_lead_id has NO FK on purpose so an erasure audit row survives the lead's
// deletion. action is a free string (extensible, no enum churn). Best-effort writes.
export const audit_log = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    admin_id: uuid('admin_id'), // nullable — system/agent actions have none
    actor_type: varchar('actor_type', { length: 10 }).notNull(), // 'admin' | 'agent' | 'system'
    action: varchar('action', { length: 50 }).notNull(),
    target_lead_id: uuid('target_lead_id'), // plain uuid (no FK) — survives erasure
    details: jsonb('details'),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => ({
    lead_idx: index('audit_log_lead_idx').on(t.agency_id, t.target_lead_id),
    time_idx: index('audit_log_time_idx').on(t.agency_id, t.timestamp)
  })
);

// ─── Scheduled messages (F4a — future follow-up to a lead) ──────────────────
// A background loop (gated by RUN_SCHEDULER) delivers pending rows whose send_at
// has passed. send_at is UTC (admin thinks in Europe/Paris; converted on input).
// Cascades on lead/conversation delete so erasure cancels pending sends.
export const scheduled_messages = pgTable(
  'scheduled_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    conversation_id: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    lead_id: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    send_at: timestamp('send_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 12 }).default('pending').notNull(), // pending | sent | cancelled | failed
    created_by: uuid('created_by'), // admin id
    attempt_count: integer('attempt_count').default(0).notNull(),
    sent_at: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => ({
    due_idx: index('scheduled_messages_due_idx').on(t.status, t.send_at),
    agency_idx: index('scheduled_messages_agency_idx').on(t.agency_id)
  })
);
