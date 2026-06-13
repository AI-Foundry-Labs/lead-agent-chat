import { eq, and } from 'drizzle-orm';
import { db, admins } from '@/lib/db';

export type AgencyAdminRow = {
  id: string;
  email: string;
  name: string | null;
  telegram_user_id: string | null;
  agency_id: string;
};

/**
 * Map a Telegram sender (from.id) to an admin row scoped to a specific agency.
 * Returns null when the sender has no linked admin in that agency.
 *
 * Used in Phase 04+ for operator-turn attribution and takeover. Not a hard gate
 * for the Phase 02 group-bind step (a leaked token is the gate there).
 */
export async function resolveAgencyAdmin(
  telegramUserId: string,
  agencyId: string
): Promise<AgencyAdminRow | null> {
  const rows = await db
    .select({
      id: admins.id,
      email: admins.email,
      name: admins.name,
      telegram_user_id: admins.telegram_user_id,
      agency_id: admins.agency_id
    })
    .from(admins)
    .where(
      and(
        eq(admins.telegram_user_id, telegramUserId),
        eq(admins.agency_id, agencyId)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}
