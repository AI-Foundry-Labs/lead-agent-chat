import { z } from 'zod';
import { promises as dns } from 'node:dns';
import { getLeadByEmail, createLead } from '@/lib/db';
import { createMagicLink, destroyLeadSession } from '@/lib/auth';
import { sendEmail, buildMagicLinkEmail } from '@/lib/email';
import { getDefaultAgency } from '@/lib/db/agencies';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email(),
  lang: z.enum(['fr', 'en']).optional()
});

async function emailDomainAcceptsMail(email: string): Promise<boolean> {
  const domain = email.split('@')[1];
  if (!domain) return false;
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length > 0) return true;
  } catch {
    // Some valid domains have no MX but accept mail on A/AAAA records.
  }
  try {
    const [a, aaaa] = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolve6(domain)
    ]);
    return (
      (a.status === 'fulfilled' && a.value.length > 0) ||
      (aaaa.status === 'fulfilled' && aaaa.value.length > 0)
    );
  } catch {
    return false;
  }
}

// A visitor logs in with their email. We find or create their lead, issue a
// single-use magic link, and email it. The link is never returned to the client.
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_email' }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const lang = parsed.data.lang ?? 'fr';
  if (!(await emailDomainAcceptsMail(email))) {
    return Response.json({ error: 'invalid_email' }, { status: 400 });
  }

  // Resolve agency from Host header (set by middleware); fall back to default.
  const agencyId =
    request.headers.get('x-agency-id') ??
    (await getDefaultAgency())?.id;
  if (!agencyId) {
    return Response.json({ error: 'agency_not_configured' }, { status: 503 });
  }

  let lead = await getLeadByEmail(email, agencyId);
  if (!lead) {
    lead = await createLead({ agency_id: agencyId, channel: 'web', email });
  }

  const url = await createMagicLink(lead.id, email);
  const { subject, text, html } = buildMagicLinkEmail({ name: lead.name, url, lang });
  try {
    await sendEmail({ to: email, subject, text, html });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'email_send_failed';
    const status = msg === 'email_not_configured' ? 503 : 502;
    return Response.json({ error: msg }, { status });
  }

  // Requesting a magic link must not keep or create an authenticated browser
  // session. The visitor becomes logged in only after clicking the email link.
  await destroyLeadSession();

  return Response.json({ ok: true });
}
