import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import {
  db,
  admins,
  admin_sessions,
  lead_sessions,
  lead_magic_links
} from '@/lib/db';
import {
  createTelegramLinkToken,
  consumeTelegramLinkToken,
  createLeadTelegramLinkToken,
  consumeLeadTelegramLinkToken,
  type LeadTelegramLinkPayload
} from '@/lib/db';

export const ADMIN_COOKIE = 'admin_session';
export const LEAD_COOKIE = 'lead_session';

const ADMIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAGIC_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_LINK_TTL_MS = 10 * 60 * 1000;
const LEAD_TELEGRAM_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

const isProd = process.env.NODE_ENV === 'production';

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export type AdminInfo = { id: string; email: string; name: string | null };

export async function createAdminSession(
  adminId: string,
  meta?: { ua?: string; ip?: string }
): Promise<string> {
  const token = newToken();
  await db.insert(admin_sessions).values({
    token_hash: sha256(token),
    admin_id: adminId,
    expires_at: new Date(Date.now() + ADMIN_TTL_MS),
    user_agent: meta?.ua?.slice(0, 500),
    ip: meta?.ip
  });
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_TTL_MS / 1000
  });
  return token;
}

export async function getAdminFromCookies(): Promise<AdminInfo | null> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ id: admins.id, email: admins.email, name: admins.name })
    .from(admin_sessions)
    .innerJoin(admins, eq(admins.id, admin_sessions.admin_id))
    .where(
      and(
        eq(admin_sessions.token_hash, sha256(token)),
        gt(admin_sessions.expires_at, new Date())
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function destroyAdminSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) {
    await db
      .delete(admin_sessions)
      .where(eq(admin_sessions.token_hash, sha256(token)));
  }
  jar.delete(ADMIN_COOKIE);
}

export async function setLeadCookie(
  leadId: string,
  meta?: { ua?: string; ip?: string; persistent?: boolean }
): Promise<void> {
  const token = newToken();
  await db.insert(lead_sessions).values({
    token_hash: sha256(token),
    lead_id: leadId,
    expires_at: new Date(Date.now() + LEAD_TTL_MS),
    user_agent: meta?.ua?.slice(0, 500),
    ip: meta?.ip
  });
  const jar = await cookies();
  jar.set(LEAD_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    ...(meta?.persistent ? { maxAge: LEAD_TTL_MS / 1000 } : {})
  });
}

export async function getLeadIdFromCookies(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(LEAD_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ lead_id: lead_sessions.lead_id })
    .from(lead_sessions)
    .where(
      and(
        eq(lead_sessions.token_hash, sha256(token)),
        gt(lead_sessions.expires_at, new Date())
      )
    )
    .limit(1);
  return rows[0]?.lead_id ?? null;
}

export async function destroyLeadSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(LEAD_COOKIE)?.value;
  if (token) {
    await db
      .delete(lead_sessions)
      .where(eq(lead_sessions.token_hash, sha256(token)));
  }
  jar.delete(LEAD_COOKIE);
}

export async function createMagicLink(
  leadId: string,
  email: string
): Promise<string> {
  const token = newToken();
  await db.insert(lead_magic_links).values({
    token_hash: sha256(token),
    lead_id: leadId,
    email,
    expires_at: new Date(Date.now() + MAGIC_TTL_MS)
  });
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  return `${base}/api/auth/lead-callback?token=${encodeURIComponent(token)}`;
}

export async function consumeMagicLink(token: string): Promise<string | null> {
  const [row] = await db
    .update(lead_magic_links)
    .set({ consumed_at: new Date() })
    .where(
      and(
        eq(lead_magic_links.token_hash, sha256(token)),
        gt(lead_magic_links.expires_at, new Date()),
        isNull(lead_magic_links.consumed_at)
      )
    )
    .returning({ lead_id: lead_magic_links.lead_id });
  return row?.lead_id ?? null;
}

// ─── Telegram linking (admin /start <token>) ───────────────────────────────

export async function issueTelegramLinkToken(adminId: string): Promise<string> {
  const token = newToken();
  await createTelegramLinkToken({
    token_hash: sha256(token),
    admin_id: adminId,
    expires_at: new Date(Date.now() + TELEGRAM_LINK_TTL_MS)
  });
  return token;
}

export async function consumeTelegramLink(token: string): Promise<string | null> {
  return consumeTelegramLinkToken(sha256(token));
}

// ─── Lead Telegram linking (visitor /start <token> from site deep link) ─────

export async function issueLeadTelegramLinkToken(input: {
  conversationId: string;
  leadId?: string | null;
  listingId?: string | null;
}): Promise<string> {
  const token = newToken();
  await createLeadTelegramLinkToken({
    token_hash: sha256(token),
    conversation_id: input.conversationId,
    lead_id: input.leadId ?? null,
    listing_id: input.listingId ?? null,
    expires_at: new Date(Date.now() + LEAD_TELEGRAM_LINK_TTL_MS)
  });
  return token;
}

export async function consumeLeadTelegramLink(
  token: string
): Promise<LeadTelegramLinkPayload | null> {
  return consumeLeadTelegramLinkToken(sha256(token));
}

export class AuthError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

export async function requireAdmin(): Promise<AdminInfo> {
  const a = await getAdminFromCookies();
  if (!a) throw new AuthError(401, 'unauthorized');
  return a;
}

export function toAuthResponse(e: unknown): Response | null {
  if (e instanceof AuthError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  return null;
}

export async function sweepExpired(): Promise<void> {
  const now = new Date();
  await Promise.all([
    db.delete(admin_sessions).where(lt(admin_sessions.expires_at, now)),
    db.delete(lead_sessions).where(lt(lead_sessions.expires_at, now)),
    db.delete(lead_magic_links).where(lt(lead_magic_links.expires_at, now))
  ]);
}
