import { destroyAdminSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST() {
  await destroyAdminSession();
  return Response.json({ ok: true });
}
