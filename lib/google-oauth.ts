import { google } from 'googleapis';

export type GoogleOAuthIntent = 'lead' | 'admin';

export type GoogleProfile = {
  email: string;
  name: string | null;
  picture: string | null;
};

function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

export function createGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${appBaseUrl()}/api/auth/google/callback`
  );
}

export function buildGoogleAuthUrl(state: string): string | null {
  const client = createGoogleOAuthClient();
  if (!client) return null;

  return client.generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state
  });
}

export async function fetchGoogleProfile(code: string): Promise<GoogleProfile> {
  const client = createGoogleOAuthClient();
  if (!client) throw new Error('google_oauth_not_configured');

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  const email = data.email?.toLowerCase();
  if (!email) throw new Error('google_email_missing');

  return {
    email,
    name: data.name ?? null,
    picture: data.picture ?? null
  };
}

export function safeRedirectPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}
