import { eq } from 'drizzle-orm';
import { db, listings } from '@/lib/db';
import { getAgencyByHost, getDefaultAgency } from '@/lib/db/agencies';
import type { Agency } from '@/lib/db/agencies';

// Dev hostnames that always resolve to the default agency.
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Resolve the agency for an incoming web visit.
 *
 * HOST-FIRST rule (locked in plan red-team C3):
 *   1. host → agencies.primary_host  (primary resolver)
 *   2. if listingId is present, consistency-check listing.agency_id against
 *      the resolved agency; on mismatch log a warning and trust the host.
 *   3. getDefaultAgency() as last-resort fallback.
 *
 * Dev override: localhost / 127.0.0.1 always use the default agency so local
 * development works without needing a primary_host entry.
 */
export async function resolveAgencyForVisit(input: {
  host: string;
  listingId?: string | null;
}): Promise<Agency | null> {
  const { host, listingId } = input;

  // Strip port safely, handling IPv6 addresses like "[::1]:3000".
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : (host.split(':')[0] ?? host);

  // Dev override — always default agency on local machines.
  if (DEV_HOSTS.has(hostname)) {
    return getDefaultAgency();
  }

  // Primary: host → agency.
  let agency = await getAgencyByHost(hostname);

  if (!agency) {
    // Fallback: no primary_host match → use default agency.
    agency = await getDefaultAgency();
    if (!agency) return null;
  }

  // Consistency check: if a listingId is present, verify it belongs to the
  // same agency. Mismatch = log warning + trust host (don't switch agencies).
  if (listingId) {
    const rows = await db
      .select({ agency_id: listings.agency_id })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    const listingAgencyId = rows[0]?.agency_id;
    if (listingAgencyId && listingAgencyId !== agency.id) {
      console.warn(
        `[agency-context] Listing ${listingId} belongs to agency ${listingAgencyId} ` +
          `but host "${hostname}" resolved to agency ${agency.id}. Trusting host.`
      );
    }
  }

  return agency;
}
