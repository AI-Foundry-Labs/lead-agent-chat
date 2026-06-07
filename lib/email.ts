import sgMail from '@sendgrid/mail';

// Normalised inbound email payload (from Sendgrid Inbound Parse).
export interface ParsedInbound {
  email: string;
  name: string | null;
  listing_id: string | null;
  content: string;
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return;
  sgMail.setApiKey(key);
  configured = true;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  ensureConfigured();
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!process.env.SENDGRID_API_KEY || !from) {
    throw new Error('email_not_configured');
  }
  try {
    await sgMail.send({
      to: args.to,
      from: {
        email: from,
        name: process.env.SENDGRID_FROM_NAME ?? 'Agence Lumière'
      },
      subject: args.subject,
      text: args.text,
      ...(args.html ? { html: args.html } : {})
    });
  } catch (e: unknown) {
    const err = e as { code?: number; response?: { body?: unknown } };
    console.error(
      `[email] Sendgrid send failed (code ${err.code ?? '?'}).`,
      err.response?.body ?? ''
    );
    throw new Error('email_send_failed');
  }
}

export function buildMagicLinkEmail(opts: {
  name: string | null;
  url: string;
  lang: 'fr' | 'en';
}): { subject: string; text: string; html: string } {
  const greeting =
    opts.lang === 'fr'
      ? `Bonjour${opts.name ? ' ' + opts.name : ''},`
      : `Hello${opts.name ? ' ' + opts.name : ''},`;
  const intro =
    opts.lang === 'fr'
      ? 'Cliquez sur le lien ci-dessous pour vous connecter à Agence Lumière :'
      : 'Click the link below to log in to Agence Lumière:';
  const cta =
    opts.lang === 'fr' ? 'Se connecter' : 'Log in';
  const expiry =
    opts.lang === 'fr'
      ? 'Ce lien expire dans 15 minutes et ne peut être utilisé qu\'une seule fois.'
      : 'This link expires in 15 minutes and can only be used once.';
  const subject =
    opts.lang === 'fr'
      ? 'Votre lien de connexion Agence Lumière'
      : 'Your Agence Lumière login link';

  const text = `${greeting}\n\n${intro}\n\n${opts.url}\n\n${expiry}\n`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p style="font-size: 16px; color: #111;">${greeting}</p>
      <p style="font-size: 14px; color: #444;">${intro}</p>
      <p style="margin: 24px 0;">
        <a href="${opts.url}" style="background: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">${cta}</a>
      </p>
      <p style="font-size: 12px; color: #888;">${expiry}</p>
    </div>
  `.trim();

  return { subject, text, html };
}

// Parse a Sendgrid Inbound Parse multipart form payload into our normalized model.
// Inbound Parse sends fields: from, to, subject, text, html, headers, envelope, ...
export function parseInbound(form: FormData): ParsedInbound | null {
  const from = (form.get('from') as string | null) ?? '';
  const text = (form.get('text') as string | null) ?? '';
  const subject = (form.get('subject') as string | null) ?? '';

  const emailMatch = from.match(/<([^>]+)>/) ?? from.match(/([\w.+-]+@[\w-]+\.[\w.-]+)/);
  const email = emailMatch ? emailMatch[1] : '';
  if (!email) return null;

  const nameMatch = from.match(/^([^<]+?)\s*</);
  const name = nameMatch ? nameMatch[1].trim() : null;

  // Naive listing inference from subject — production would use threading headers.
  const listingMatch = subject.match(/\[listing:([a-z0-9-]+)\]/i);
  const listing_id = listingMatch ? listingMatch[1] : null;

  return {
    email,
    name,
    listing_id,
    content: stripQuoted(text)
  };
}

function stripQuoted(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .* wrote:$/.test(line.trim())) break;
    if (/^Le .* a écrit\s*:$/.test(line.trim())) break;
    if (line.trim().startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}
