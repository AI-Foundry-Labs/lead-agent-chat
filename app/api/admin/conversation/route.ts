import { type NextRequest } from 'next/server';
import {
  getLeadById,
  getConversationByLeadId,
  getVisibleMessages
} from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

// Full thread + qualification for one lead (Conversations tab detail view).
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const leadId = req.nextUrl.searchParams.get('lead_id');
    if (!leadId) return Response.json({ error: 'lead_id required' }, { status: 400 });

    const lead = await getLeadById(leadId);
    if (!lead || lead.agency_id !== admin.agency_id) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    const conv = await getConversationByLeadId(leadId);
    const messages = conv ? await getVisibleMessages(conv.id) : [];

    return Response.json({
      lead: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        status: lead.status,
        potential: lead.potential_status,
        reason: lead.score_reason,
        qual_values: lead.qual_values,
        long_term_memory: lead.long_term_memory
      },
      conversation_id: conv?.id ?? null,
      mode: conv?.mode ?? null,
      messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))
    });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}
