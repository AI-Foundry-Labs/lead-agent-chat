import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, admins } from '@/lib/db';
import { verifyPassword, createAdminSession } from '@/lib/auth';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200)
});

const ipBuckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  if (!rateLimit(ip)) {
    return Response.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_input' }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(admins)
    .where(eq(admins.email, parsed.data.email.toLowerCase()))
    .limit(1);
  const admin = rows[0];

  const ok = admin && (await verifyPassword(parsed.data.password, admin.password_hash));
  if (!admin || !ok) {
    await new Promise((r) => setTimeout(r, 200));
    return Response.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  await createAdminSession(admin.id, {
    ua: request.headers.get('user-agent') ?? undefined,
    ip
  });
  await db
    .update(admins)
    .set({ last_login_at: new Date() })
    .where(eq(admins.id, admin.id));

  return Response.json({
    ok: true,
    admin: { id: admin.id, email: admin.email, name: admin.name }
  });
}
