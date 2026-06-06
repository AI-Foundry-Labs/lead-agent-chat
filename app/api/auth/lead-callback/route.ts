import { consumeMagicLink, setLeadCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const base = process.env.APP_BASE_URL ?? new URL(request.url).origin;

  if (!token) return Response.redirect(`${base}/?login=invalid`, 302);

  const leadId = await consumeMagicLink(token);
  if (!leadId) return Response.redirect(`${base}/?login=invalid`, 302);

  await setLeadCookie(leadId, {
    ua: request.headers.get('user-agent') ?? undefined,
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      undefined,
    persistent: true
  });

  return Response.redirect(`${base}/?login=ok`, 302);
}
