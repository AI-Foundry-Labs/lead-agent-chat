import { eq } from 'drizzle-orm';
import { db, agencies } from './client';

export type Agency = {
  id: string;
  name: string;
  slug: string;
  primary_host: string | null;
  telegram_group_chat_id: string | null;
  telegram_topics_enabled: boolean;
  /** message_thread_id of the 🛠 Master topic; null until created. */
  telegram_master_topic_id: number | null;
  created_at: Date;
};

function rowToAgency(r: typeof agencies.$inferSelect): Agency {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    primary_host: r.primary_host ?? null,
    telegram_group_chat_id: r.telegram_group_chat_id ?? null,
    telegram_topics_enabled: r.telegram_topics_enabled,
    telegram_master_topic_id: r.telegram_master_topic_id ?? null,
    created_at: r.created_at
  };
}

export async function getAgencyById(id: string): Promise<Agency | null> {
  const rows = await db.select().from(agencies).where(eq(agencies.id, id)).limit(1);
  return rows[0] ? rowToAgency(rows[0]) : null;
}

/** Resolve agency by the request Host header value. Returns null if unmapped. */
export async function getAgencyByHost(host: string): Promise<Agency | null> {
  const rows = await db
    .select()
    .from(agencies)
    .where(eq(agencies.primary_host, host))
    .limit(1);
  return rows[0] ? rowToAgency(rows[0]) : null;
}

/** Used by Phase 02+: route inbound group Telegram messages to an agency. */
export async function getAgencyByTelegramGroup(
  chatId: string
): Promise<Agency | null> {
  const rows = await db
    .select()
    .from(agencies)
    .where(eq(agencies.telegram_group_chat_id, chatId))
    .limit(1);
  return rows[0] ? rowToAgency(rows[0]) : null;
}

/**
 * Returns the first agency ordered by created_at (the "default" agency).
 * Used as last-resort fallback when host→agency resolution fails.
 */
export async function getDefaultAgency(): Promise<Agency | null> {
  const rows = await db
    .select()
    .from(agencies)
    .orderBy(agencies.created_at)
    .limit(1);
  return rows[0] ? rowToAgency(rows[0]) : null;
}

export async function createAgency(input: {
  name: string;
  slug: string;
  primary_host?: string | null;
}): Promise<Agency> {
  const [r] = await db
    .insert(agencies)
    .values({
      name: input.name,
      slug: input.slug,
      primary_host: input.primary_host ?? null
    })
    .returning();
  return rowToAgency(r);
}
