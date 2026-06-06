import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, admins, telegram_link_tokens } from './client';

export type AdminRow = {
  id: string;
  email: string;
  name: string | null;
  telegram_user_id: string | null;
};

export async function getAdminByTelegramUserId(
  telegramUserId: string
): Promise<AdminRow | null> {
  const rows = await db
    .select({
      id: admins.id,
      email: admins.email,
      name: admins.name,
      telegram_user_id: admins.telegram_user_id
    })
    .from(admins)
    .where(eq(admins.telegram_user_id, telegramUserId))
    .limit(1);
  return rows[0] ?? null;
}

export async function bindTelegramToAdmin(
  adminId: string,
  telegramUserId: string
): Promise<void> {
  await db
    .update(admins)
    .set({ telegram_user_id: telegramUserId })
    .where(eq(admins.id, adminId));
}

export async function createTelegramLinkToken(input: {
  token_hash: string;
  admin_id: string;
  expires_at: Date;
}): Promise<void> {
  await db.insert(telegram_link_tokens).values(input);
}

// Consume a link token (single-use, unexpired) and return the bound admin id.
export async function consumeTelegramLinkToken(
  tokenHash: string
): Promise<string | null> {
  const [row] = await db
    .update(telegram_link_tokens)
    .set({ consumed_at: new Date() })
    .where(
      and(
        eq(telegram_link_tokens.token_hash, tokenHash),
        gt(telegram_link_tokens.expires_at, new Date()),
        isNull(telegram_link_tokens.consumed_at)
      )
    )
    .returning({ admin_id: telegram_link_tokens.admin_id });
  return row?.admin_id ?? null;
}
