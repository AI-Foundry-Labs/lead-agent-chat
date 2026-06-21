import { z } from 'zod';
import { requireAdmin, toAuthResponse } from '@/lib/auth';
import { updateAdminPersona } from '@/lib/db/admins';

export const runtime = 'nodejs';

const schema = z.object({ persona: z.string().max(3000).nullable() });

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
    await updateAdminPersona(admin.id, parsed.data.persona);
    return Response.json({ ok: true });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}
