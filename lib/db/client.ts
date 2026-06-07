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
  lead_telegram_link_tokens
} = schema;
