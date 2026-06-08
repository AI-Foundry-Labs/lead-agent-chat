import { requireAdmin, toAuthResponse } from '@/lib/auth';
import { getConversation, getVisibleMessages } from '@/lib/db';
import { subscribeConversation } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type MsgSnapshot = { id: string; role: string; content: string };

async function buildSnapshot(conversationId: string): Promise<MsgSnapshot[]> {
  const messages = await getVisibleMessages(conversationId);
  return messages.map((m) => ({ id: m.id, role: m.role, content: m.content }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversationId');
  if (!conversationId) return new Response('missing conversationId', { status: 400 });

  try {
    await requireAdmin();
  } catch (e) {
    return toAuthResponse(e) ?? new Response('unauthorized', { status: 401 });
  }

  const conv = await getConversation(conversationId);
  if (!conv) return new Response('not_found', { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = async () => {
        if (closed) return;
        try {
          const messages = await buildSnapshot(conversationId);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ messages })}\n\n`)
          );
        } catch {}
      };

      await send();

      const unsubscribe = subscribeConversation(conversationId, () => void send());
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch {}
      }, 25000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch {}
      };
      request.signal.addEventListener('abort', cleanup);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
