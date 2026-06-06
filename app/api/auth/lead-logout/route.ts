import { destroyLeadSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST() {
  await destroyLeadSession();
  return Response.json({ ok: true });
}
