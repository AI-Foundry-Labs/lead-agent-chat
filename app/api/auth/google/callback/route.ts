import { eq } from 'drizzle-orm';
import { db, admins, getLeadByEmail, createLead, updateLead } from '@/lib/db';
import { getOrCreateLeadTopics } from '@/lib/telegram/lead-topics';
import { createAdminSession, setLeadCookie } from '@/lib/auth';
import { fetchGoogleProfile, safeRedirectPath } from '@/lib/google-oauth';
import { consumeOAuthState } from '@/lib/oauth-state';
import { getDefaultAgency } from '@/lib/db/agencies';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = process.env.APP_BASE_URL ?? new URL(request.url).origin;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const stored = await consumeOAuthState(state);
  const fallback =
    stored?.intent === 'admin'
      ? safeRedirectPath(stored.next, '/admin')
      : safeRedirectPath(stored?.next, '/');

  if (oauthError || !code || !stored) {
    const errorTarget =
      stored?.intent === 'admin'
        ? `${base}/admin/login?error=google`
        : `${base}${fallback}?login=google_error`;
    return Response.redirect(errorTarget, 302);
  }

  try {
    const profile = await fetchGoogleProfile(code);
    const meta = {
      ua: request.headers.get('user-agent') ?? undefined,
      ip:
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        request.headers.get('x-real-ip') ??
        undefined
    };

    if (stored.intent === 'admin') {
      const [admin] = await db
        .select()
        .from(admins)
        .where(eq(admins.email, profile.email))
        .limit(1);

      if (!admin) {
        return Response.redirect(`${base}/admin/login?error=google_not_allowed`, 302);
      }

      await createAdminSession(admin.id, meta);
      await db
        .update(admins)
        .set({ last_login_at: new Date(), name: admin.name ?? profile.name })
        .where(eq(admins.id, admin.id));

      return Response.redirect(`${base}${stored.next}?login=ok`, 302);
    }

    // Resolve agency from Host header (set by middleware); fall back to default.
    const agencyId =
      request.headers.get('x-agency-id') ??
      (await getDefaultAgency())?.id;
    if (!agencyId) {
      return Response.redirect(`${base}${fallback}?login=google_error`, 302);
    }

    let lead = await getLeadByEmail(profile.email, agencyId);
    if (!lead) {
      lead = await createLead({
        agency_id: agencyId,
        channel: 'web',
        email: profile.email,
        name: profile.name
      });
      const newLeadId = lead.id;
      void getOrCreateLeadTopics(agencyId, newLeadId).catch((err) =>
        console.error('[google-callback] getOrCreateLeadTopics failed', newLeadId, err)
      );
    } else if (profile.name && !lead.name) {
      lead = await updateLead(lead.id, { name: profile.name });
    }

    await setLeadCookie(lead.id, { ...meta, persistent: true });
    return Response.redirect(`${base}${stored.next}?login=ok`, 302);
  } catch (e) {
    console.error('[auth/google/callback] failed:', e);
    const errorTarget =
      stored.intent === 'admin'
        ? `${base}/admin/login?error=google`
        : `${base}${fallback}?login=google_error`;
    return Response.redirect(errorTarget, 302);
  }
}
