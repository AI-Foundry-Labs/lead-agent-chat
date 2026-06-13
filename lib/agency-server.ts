import { headers } from 'next/headers';
import { getAgencyById, getDefaultAgency } from '@/lib/db/agencies';
import type { Agency } from '@/lib/db/agencies';

/**
 * Server-only: resolve the current agency for a request, using the
 * `x-agency-id` header that proxy.ts sets from the request Host (server-side,
 * never client-trusted). Falls back to the default agency when the proxy did
 * not resolve one (e.g. localhost dev). Use in server components / route
 * handlers that serve the PUBLIC, host-scoped surface.
 */
export async function getRequestAgency(): Promise<Agency | null> {
  const h = await headers();
  const id = h.get('x-agency-id');
  if (id) {
    const agency = await getAgencyById(id);
    if (agency) return agency;
  }
  return getDefaultAgency();
}

export async function getRequestAgencyId(): Promise<string | null> {
  return (await getRequestAgency())?.id ?? null;
}
