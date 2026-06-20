import { z } from 'zod';
import { getOrCreateMainAssistant, getVisibleMessages } from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';
import { runAgentTurn } from '@/lib/agent/run';
import { dispatchUserMessage } from '@/lib/dispatch';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const admin = await requireAdmin();
    const conv = await getOrCreateMainAssistant(admin.id, admin.agency_id);
    const messages = await getVisibleMessages(conv.id);
    return Response.json({
      conversationId: conv.id,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content
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
    const conv = await getOrCreateMainAssistant(admin.id, admin.agency_id);
    // Forward user message to Telegram so both channels stay in sync.
    void dispatchUserMessage(conv, admin.name ?? 'Admin', parsed.data.message);
    const result = await runAgentTurn(conv.id, parsed.data.message, {
      type: 'main_assistant',
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
        content: m.content
      }))
    });
  } catch (e) {
    const authRes = toAuthResponse(e);
    if (authRes) return authRes;
    console.error('[admin/assistant] failed:', e);
    return Response.json({ error: 'agent_error' }, { status: 500 });
  }
}
