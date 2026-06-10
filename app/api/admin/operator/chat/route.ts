import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getLeadById,
  getOrCreateLeadOperator,
  getOrCreateAnonymousOperator,
  getVisibleMessages
} from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';
import { runAgentTurn } from '@/lib/agent/run';

export const runtime = 'nodejs';

/** Load operator chat history for a lead agent or the anonymous pool agent. */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const scope = req.nextUrl.searchParams.get('scope');
    const leadId = req.nextUrl.searchParams.get('lead_id');

    let conv;
    if (scope === 'anonymous') {
      conv = await getOrCreateAnonymousOperator();
    } else if (leadId) {
      const lead = await getLeadById(leadId);
      if (!lead) return Response.json({ error: 'not_found' }, { status: 404 });
      conv = await getOrCreateLeadOperator(leadId);
    } else {
      return Response.json({ error: 'lead_id_or_scope_required' }, { status: 400 });
    }

    const messages = await getVisibleMessages(conv.id);
    return Response.json({
      conversationId: conv.id,
      scope: scope === 'anonymous' ? 'anonymous' : 'lead',
      lead_id: leadId,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls
      }))
    });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}

const postSchema = z.object({
  scope: z.enum(['lead', 'anonymous']),
  lead_id: z.string().uuid().optional(),
  message: z.string().min(1).max(4000)
});

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: 'invalid_input' }, { status: 400 });
    }

    if (parsed.data.scope === 'anonymous') {
      const conv = await getOrCreateAnonymousOperator();
      const result = await runAgentTurn(conv.id, parsed.data.message, {
        type: 'operator',
        leadId: null,
        adminId: admin.id,
        adminName: admin.name
      });
      const messages = await getVisibleMessages(conv.id);
      return Response.json({
        conversationId: conv.id,
        reply: result.reply,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls
        }))
      });
    }

    if (!parsed.data.lead_id) {
      return Response.json({ error: 'lead_id_required' }, { status: 400 });
    }
    const lead = await getLeadById(parsed.data.lead_id);
    if (!lead) return Response.json({ error: 'not_found' }, { status: 404 });

    const conv = await getOrCreateLeadOperator(parsed.data.lead_id);
    const result = await runAgentTurn(conv.id, parsed.data.message, {
      type: 'operator',
      leadId: parsed.data.lead_id,
      adminId: admin.id,
      adminName: admin.name
    });
    const messages = await getVisibleMessages(conv.id);
    return Response.json({
      conversationId: conv.id,
      reply: result.reply,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls
      }))
    });
  } catch (e) {
    const authRes = toAuthResponse(e);
    if (authRes) return authRes;
    console.error('[admin/operator/chat] failed:', e);
    return Response.json({ error: 'agent_error' }, { status: 500 });
  }
}
