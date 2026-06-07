import { NextRequest } from 'next/server';
import {
  buildGoogleAuthUrl,
  isGoogleOAuthConfigured,
  safeRedirectPath,
  type GoogleOAuthIntent
} from '@/lib/google-oauth';
import { issueOAuthState } from '@/lib/oauth-state';

export const runtime = 'nodejs';

function parseIntent(value: string | null): GoogleOAuthIntent | null {
  return value === 'lead' || value === 'admin' ? value : null;
}

export async function GET(request: NextRequest) {
  const base = process.env.APP_BASE_URL ?? request.nextUrl.origin;
  const intent = parseIntent(request.nextUrl.searchParams.get('intent'));
  const nextParam = request.nextUrl.searchParams.get('next');

  if (!intent) {
    return Response.redirect(`${base}/?login=invalid`, 302);
  }

  if (!isGoogleOAuthConfigured()) {
    const fallback =
      intent === 'admin'
        ? `${base}/admin/login?error=google_unconfigured`
        : `${base}/?login=google_unconfigured`;
    return Response.redirect(fallback, 302);
  }

  const next =
    intent === 'admin'
      ? safeRedirectPath(nextParam, '/admin')
      : safeRedirectPath(nextParam, '/');

  const state = await issueOAuthState(intent, next);
  const url = buildGoogleAuthUrl(state);
  if (!url) {
    return Response.redirect(`${base}/?login=google_unconfigured`, 302);
  }

  return Response.redirect(url, 302);
}
