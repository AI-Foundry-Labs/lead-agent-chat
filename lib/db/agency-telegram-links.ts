import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, agencies, agency_telegram_link_tokens } from './client';

// ─── Agency Telegram group link tokens ────────────────────────────────────

export async function createAgencyTelegramLinkToken(input: {
  token_hash: string;
  agency_id: string;
  expires_at: Date;
}): Promise<void> {
  await db.insert(agency_telegram_link_tokens).values(input);
}

/**
 * Atomic single-use consume. Returns agency_id if token is valid/unexpired,
 * null if already consumed, expired, or not found.
 */
export async function consumeAgencyTelegramLinkToken(
  tokenHash: string
): Promise<string | null> {
  const [row] = await db
    .update(agency_telegram_link_tokens)
    .set({ consumed_at: new Date() })
    .where(
      and(
        eq(agency_telegram_link_tokens.token_hash, tokenHash),
        gt(agency_telegram_link_tokens.expires_at, new Date()),
        isNull(agency_telegram_link_tokens.consumed_at)
      )
    )
    .returning({ agency_id: agency_telegram_link_tokens.agency_id });
  return row?.agency_id ?? null;
}

// ─── Group binding ─────────────────────────────────────────────────────────

/**
 * Set agencies.telegram_group_chat_id for the given agency.
 * Idempotent — re-linking another group updates the binding safely.
 */
export async function bindTelegramGroupToAgency(
  agencyId: string,
  groupChatId: string
): Promise<void> {
  // Single-topic UX: per-lead forum topic pairs are DISABLED. Everything happens in
  // the 🛠 Master topic via the assistant + slash commands (/leads, /lead_history, …).
  // The Master topic itself is created separately by the bind/link handler.
  await db
    .update(agencies)
    .set({ telegram_group_chat_id: groupChatId, telegram_topics_enabled: false })
    .where(eq(agencies.id, agencyId));
}

/**
 * Atomically claim the 🛠 Master topic slot for an agency.
 *
 * Conditional on telegram_master_topic_id IS NULL so two concurrent / retried
 * bind events can't both register a Master topic. Returns true when THIS call
 * won the claim (so the caller keeps its just-created topic), false when another
 * call already set it (caller should clean up its orphan topic).
 */
export async function setAgencyMasterTopic(
  agencyId: string,
  threadId: number
): Promise<boolean> {
  const rows = await db
    .update(agencies)
    .set({ telegram_master_topic_id: threadId })
    .where(and(eq(agencies.id, agencyId), isNull(agencies.telegram_master_topic_id)))
    .returning({ id: agencies.id });
  return rows.length > 0;
}
