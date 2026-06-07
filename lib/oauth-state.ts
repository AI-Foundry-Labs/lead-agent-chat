import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import type { GoogleOAuthIntent } from '@/lib/google-oauth';

export const OAUTH_STATE_COOKIE = 'google_oauth_state';
const TTL_MS = 10 * 60 * 1000;
const isProd = process.env.NODE_ENV === 'production';

type OAuthStatePayload = {
  state: string;
  intent: GoogleOAuthIntent;
  next: string;
  exp: number;
};

function newStateToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function issueOAuthState(
  intent: GoogleOAuthIntent,
  next: string
): Promise<string> {
  const payload: OAuthStatePayload = {
    state: newStateToken(),
    intent,
    next,
    exp: Date.now() + TTL_MS
  };
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_MS / 1000
  });
  return payload.state;
}

export async function consumeOAuthState(
  state: string | null
): Promise<OAuthStatePayload | null> {
  if (!state) return null;
  const jar = await cookies();
  const raw = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as OAuthStatePayload;
    if (payload.state !== state) return null;
    if (payload.exp < Date.now()) return null;
    if (payload.intent !== 'lead' && payload.intent !== 'admin') return null;
    return payload;
  } catch {
    return null;
  }
}
