import { parseInbound } from '@/lib/email';
import {
  getLeadByEmail,
  createLead,
  getConversationByLeadId,
  createConversation,
  updateConversation
} from '@/lib/db';
import { getAgencyByHost, getDefaultAgency } from '@/lib/db/agencies';
import { getOrCreateLeadTopics } from '@/lib/telegram/lead-topics';
import { runAgentTurn } from '@/lib/agent/run';

export const runtime = 'nodejs';

// Sendgrid Inbound Parse posts a multipart form. Route the message through the
// same agent loop the web chat uses — channel just changes how the reply is sent.
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response('bad form', { status: 400 });
  }

  const parsed = parseInbound(form);
  if (!parsed) return new Response('no sender', { status: 200 });

  // Best-effort agency resolution from the inbound recipient address (the `to`
  // field from Sendgrid), matched against agencies.primary_host by domain.
  // Falls back to getDefaultAgency() when no match is found.
  // TODO: multi-agency inbound email routing — wire per-agency inbound addresses.
  let agency = null;
  const toField = (form.get('to') as string | null) ?? '';
  const toDomainMatch = toField.match(/@([\w.-]+)/);
  if (toDomainMatch) {
    agency = await getAgencyByHost(toDomainMatch[1]);
  }
  if (!agency) agency = await getDefaultAgency();
  if (!agency) return new Response('agency_not_configured', { status: 503 });

  let lead = await getLeadByEmail(parsed.email, agency.id);
  if (!lead) {
    lead = await createLead({
      agency_id: agency.id,
      channel: 'email',
      email: parsed.email,
      name: parsed.name,
      listing_id: parsed.listing_id
    });
    const newLeadId = lead.id;
    void getOrCreateLeadTopics(agency.id, newLeadId).catch((err) =>
      console.error('[email] getOrCreateLeadTopics failed', newLeadId, err)
    );
  }

  let conv = await getConversationByLeadId(lead.id);
  if (!conv) {
    conv = await createConversation({
      agency_id: lead.agency_id,
      type: 'lead',
      lead_id: lead.id,
      listing_id: parsed.listing_id ?? lead.listing_id,
      primary_channel: 'email'
    });
  } else if (conv.primary_channel !== 'email') {
    conv = await updateConversation(conv.id, { primary_channel: 'email' });
  }

  try {
    await runAgentTurn(conv.id, parsed.content, { type: 'lead' });
  } catch (e) {
    console.error('[email] turn failed:', e);
  }
  // Always 200 so Sendgrid does not retry.
  return new Response('ok', { status: 200 });
}
