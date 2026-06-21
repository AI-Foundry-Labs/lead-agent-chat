import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url && process.env.NODE_ENV !== 'production') {
  console.warn('DATABASE_URL is not set — DB operations will fail.');
}

const client = url ? postgres(url, { prepare: false }) : (null as never);
export const db = url ? drizzle(client, { schema }) : (null as never);

export const {
  agencies,
  conversations,
  messages,
  leads,
  viewing_slots,
  agency_config,
  listings,
  handoff_rules,
  admins,
  admin_sessions,
  lead_sessions,
  lead_magic_links,
  telegram_link_tokens,
  lead_telegram_link_tokens,
  agency_telegram_link_tokens,
  lead_telegram_topics,
  telegram_agent_sessions,
  message_templates,
  lead_consents,
  audit_log,
  scheduled_messages
} = schema;
