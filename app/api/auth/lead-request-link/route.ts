import { z } from 'zod';
import { getLeadByEmail, createLead } from '@/lib/db';
import { createMagicLink } from '@/lib/auth';
import { sendEmail, buildMagicLinkEmail } from '@/lib/email';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email(),
  lang: z.enum(['fr', 'en']).optional()
});

// A visitor logs in with their email. We find or create their lead, issue a
// single-use magic link, and email it. In dev (no Sendgrid) the link is returned
// in the response so the flow is testable without a mail provider.
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: true });

  const email = parsed.data.email.toLowerCase();
  const lang = parsed.data.lang ?? 'fr';

  let lead = await getLeadByEmail(email);
  if (!lead) lead = await createLead({ channel: 'web', email });

  const url = await createMagicLink(lead.id, email);
  const { subject, text, html } = buildMagicLinkEmail({ name: lead.name, url, lang });
  await sendEmail({ to: email, subject, text, html });

  const devMode = !process.env.SENDGRID_API_KEY;
  return Response.json({ ok: true, ...(devMode ? { dev_link: url } : {}) });
}
