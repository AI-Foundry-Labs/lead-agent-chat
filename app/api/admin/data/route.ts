import {
  listLeads,
  listListings,
  getAgencyConfig,
  listHandoffRules,
  listBookedViewings
} from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

// One read endpoint powering the Dashboard, Conversations and Config tabs.
export async function GET() {
  try {
    await requireAdmin();
    const [leads, listings, config, rules, booked] = await Promise.all([
      listLeads(),
      listListings(),
      getAgencyConfig(),
      listHandoffRules(),
      listBookedViewings()
    ]);

    const titleById = new Map(listings.map((l) => [l.id, l.title]));
    const slotByLead = new Map(
      booked
        .filter((b) => b.lead_id && b.confirmed_slot)
        .map((b) => [b.lead_id as string, b.confirmed_slot!.toISOString()])
    );

    return Response.json({
      leads: leads.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        listing_id: l.listing_id,
        listing_title: l.listing_id ? titleById.get(l.listing_id) ?? null : null,
        status: l.status,
        potential: l.potential_status,
        reason: l.score_reason,
        qual_values: l.qual_values,
        booked_slot: slotByLead.get(l.id) ?? null,
        updated_at: l.updated_at
      })),
      listings,
      criteria: config?.qualification_criteria ?? [],
      config: config ? { name: config.name, tone: config.tone } : null,
      rules
    });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}
