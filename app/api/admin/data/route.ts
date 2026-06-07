import {
  listIdentifiedLeads,
  listListings,
  getAgencyConfig,
  listHandoffRules,
  listBookedViewings,
  listAnonymousVisitorThreads,
  listConversationsByLeadId
} from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireAdmin();
    const [leads, listings, config, rules, booked, anonThreads] = await Promise.all([
      listIdentifiedLeads(),
      listListings(),
      getAgencyConfig(),
      listHandoffRules(),
      listBookedViewings(),
      listAnonymousVisitorThreads()
    ]);

    const titleById = new Map(listings.map((l) => [l.id, l.title]));
    const slotByLead = new Map(
      booked
        .filter((b) => b.lead_id && b.confirmed_slot)
        .map((b) => [b.lead_id as string, b.confirmed_slot!.toISOString()])
    );

    const leadsWithThreads = await Promise.all(
      leads.map(async (l) => {
        const threads = await listConversationsByLeadId(l.id);
        return {
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
          thread_count: threads.length,
          updated_at: l.updated_at
        };
      })
    );

    return Response.json({
      leads: leadsWithThreads,
      anonymous: {
        thread_count: anonThreads.length,
        handoff_count: anonThreads.filter((t) => t.mode === 'manual').length
      },
      listings,
      criteria: config?.qualification_criteria ?? [],
      config: config ? { name: config.name, tone: config.tone } : null,
      rules
    });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}
