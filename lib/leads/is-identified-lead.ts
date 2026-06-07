import type { Lead } from '@/lib/types';

/** Lead with captured name or email — not the anonymous pool. */
export function isIdentifiedLead(lead: Lead): boolean {
  return Boolean(lead.email?.trim() || lead.name?.trim());
}
