// Dev-only endpoint: create a lead session without magic link / email verification.
// Returns 404 in production.
import { NextRequest } from 'next/server';
import { getDefaultAgency } from '@/lib/db';
import { getLeadByEmail, createLead } from '@/lib/db/leads';
import { setLeadCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const { email } = (await req.json()) as { email?: string };
  if (!email?.trim()) {
    return Response.json({ error: 'email_required' }, { status: 400 });
  }

  const agency = await getDefaultAgency();
  if (!agency) return Response.json({ error: 'no_agency' }, { status: 500 });

  let lead = await getLeadByEmail(email.trim(), agency.id);
  if (!lead) {
    lead = await createLead({
      agency_id: agency.id,
      channel: 'web',
      email: email.trim(),
      name: email.split('@')[0]
    });
  }

  const ua = req.headers.get('user-agent') ?? undefined;
  await setLeadCookie(lead.id, { ua, persistent: true });

  return Response.json({ ok: true, lead_id: lead.id });
}
