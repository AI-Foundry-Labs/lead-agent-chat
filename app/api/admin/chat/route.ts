import { z } from 'zod';
import { getOrCreateAdminAssistant, getVisibleMessages } from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';
import { runAgentTurn } from '@/lib/agent/run';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const admin = await requireAdmin();
    const conv = await getOrCreateAdminAssistant(admin.id);
    const messages = await getVisibleMessages(conv.id);
    return Response.json({
      conversationId: conv.id,
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

const postSchema = z.object({ message: z.string().min(1).max(4000) });

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: 'invalid_input' }, { status: 400 });
    }
    const conv = await getOrCreateAdminAssistant(admin.id);
    const result = await runAgentTurn(conv.id, parsed.data.message, {
      type: 'admin',
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
    console.error('[admin/chat] failed:', e);
    return Response.json({ error: 'agent_error' }, { status: 500 });
  }
}
