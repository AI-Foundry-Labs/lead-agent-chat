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
  // Keep telegram_topics_enabled=false so getOrCreateLeadTopics stays a no-op; the
  // Master topic itself is created separately by the /link handler.
  await db
    .update(agencies)
    .set({ telegram_group_chat_id: groupChatId, telegram_topics_enabled: false })
    .where(eq(agencies.id, agencyId));
}

/**
 * Persist the 🛠 Master topic thread id for an agency.
 * Called once after createForumTopic succeeds during /link.
 */
export async function setAgencyMasterTopic(
  agencyId: string,
  threadId: number
): Promise<void> {
  await db
    .update(agencies)
    .set({ telegram_master_topic_id: threadId })
    .where(eq(agencies.id, agencyId));
}
