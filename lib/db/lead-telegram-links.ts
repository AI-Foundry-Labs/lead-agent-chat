import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db, leads, lead_telegram_link_tokens } from './client';
import type { Lead } from '@/lib/types';
import { getLeadById } from './leads';

export type LeadTelegramLinkPayload = {
  conversation_id: string;
  lead_id: string | null;
  listing_id: string | null;
};

export async function getLeadByTelegramUserId(
  telegramUserId: string
): Promise<Lead | null> {
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.telegram_user_id, telegramUserId))
    .limit(1);
  return rows[0] ? getLeadById(rows[0].id) : null;
}

export async function bindTelegramToLead(
  leadId: string,
  telegramUserId: string
): Promise<void> {
  await db
    .update(leads)
    .set({ telegram_user_id: telegramUserId, updated_at: new Date() })
    .where(eq(leads.id, leadId));
}

export async function createLeadTelegramLinkToken(input: {
  token_hash: string;
  conversation_id: string;
  lead_id?: string | null;
  listing_id?: string | null;
  expires_at: Date;
}): Promise<void> {
  await db.insert(lead_telegram_link_tokens).values({
    token_hash: input.token_hash,
    conversation_id: input.conversation_id,
    lead_id: input.lead_id ?? null,
    listing_id: input.listing_id ?? null,
    expires_at: input.expires_at
  });
}

/** Consume a lead link token (single-use, unexpired) and return bound context. */
export async function consumeLeadTelegramLinkToken(
  tokenHash: string
): Promise<LeadTelegramLinkPayload | null> {
  const [row] = await db
    .update(lead_telegram_link_tokens)
    .set({ consumed_at: new Date() })
    .where(
      and(
        eq(lead_telegram_link_tokens.token_hash, tokenHash),
        gt(lead_telegram_link_tokens.expires_at, new Date()),
        isNull(lead_telegram_link_tokens.consumed_at)
      )
    )
    .returning({
      conversation_id: lead_telegram_link_tokens.conversation_id,
      lead_id: lead_telegram_link_tokens.lead_id,
      listing_id: lead_telegram_link_tokens.listing_id
    });
  return row ?? null;
}

/** Most recently updated lead row for this Telegram chat id. */
export async function getMostRecentTelegramLeadId(
  telegramUserId: string
): Promise<string | null> {
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.telegram_user_id, telegramUserId))
    .orderBy(desc(leads.updated_at))
    .limit(1);
  return rows[0]?.id ?? null;
}
