import { eq, and, asc } from 'drizzle-orm';
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

/**
 * The agency's primary (earliest-created) admin, used as a fallback identity
 * for group actions. The agency's Telegram group is private to the agency, so
 * any group member is trusted to act on its leads; we attribute the action to
 * this admin when the specific sender hasn't linked their personal Telegram.
 */
export async function getPrimaryAgencyAdmin(
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
    .where(eq(admins.agency_id, agencyId))
    .orderBy(asc(admins.created_at))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Resolve the acting admin for a group action: the sender's own linked admin
 * if present, otherwise the agency's primary admin (group is agency-private,
 * so all members are trusted). Returns null only if the agency has no admin.
 */
export async function resolveActingAdmin(
  telegramUserId: string,
  agencyId: string
): Promise<AgencyAdminRow | null> {
  return (
    (await resolveAgencyAdmin(telegramUserId, agencyId)) ??
    (await getPrimaryAgencyAdmin(agencyId))
  );
}
