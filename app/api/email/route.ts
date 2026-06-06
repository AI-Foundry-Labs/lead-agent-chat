import { parseInbound } from '@/lib/email';
import {
  getLeadByEmail,
  createLead,
  getConversationByLeadId,
  createConversation,
  updateConversation
} from '@/lib/db';
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

  let lead = await getLeadByEmail(parsed.email);
  if (!lead) {
    lead = await createLead({
      channel: 'email',
      email: parsed.email,
      name: parsed.name,
      listing_id: parsed.listing_id
    });
  }

  let conv = await getConversationByLeadId(lead.id);
  if (!conv) {
    conv = await createConversation({
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
