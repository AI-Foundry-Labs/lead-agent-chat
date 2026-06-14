import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getLeadById, updateLead } from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

const schema = z.object({ persona: z.string().max(2000) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const lead = await getLeadById(id);
    if (!lead || lead.agency_id !== admin.agency_id) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });

    const updated = await updateLead(id, { persona: parsed.data.persona || null });
    return Response.json({ ok: true, persona: updated.persona });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}
