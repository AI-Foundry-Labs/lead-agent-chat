import { getVisibleMessages, getActiveViewing } from '@/lib/db';
import { getLeadIdFromCookies } from '@/lib/auth';
import {
  assertLeadChatAccess,
  toConversationAccessResponse
} from '@/lib/conversation-access';
import { getDefaultAgency } from '@/lib/db/agencies';
import { subscribeConversation } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function buildSnapshot(
  conversationId: string,
  leadId: string | null,
  agencyId: string
) {
  const conversation = await assertLeadChatAccess(conversationId, leadId, agencyId);
  const [messages, viewing] = await Promise.all([
    getVisibleMessages(conversationId),
    getActiveViewing(conversationId)
  ]);
  return {
    mode: conversation.mode ?? null,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls
    })),
    viewing:
      viewing && viewing.status === 'booked' && viewing.confirmed_slot
        ? {
            listing_id: viewing.listing_id,
            slot: viewing.confirmed_slot.toISOString()
          }
        : null
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversationId');
  if (!conversationId) return new Response('missing conversationId', { status: 400 });

  const leadId = await getLeadIdFromCookies();
  const agencyId =
    request.headers.get('x-agency-id') ??
    (await getDefaultAgency())?.id;
  if (!agencyId) return new Response('agency_not_configured', { status: 503 });

  try {
    await assertLeadChatAccess(conversationId, leadId, agencyId);
  } catch (e) {
    const res = toConversationAccessResponse(e);
    if (res) return res;
    return new Response('error', { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = async () => {
        if (closed) return;
        try {
          const snapshot = await buildSnapshot(conversationId, leadId, agencyId);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`)
          );
        } catch {}
      };

      await send();
      const unsubscribe = subscribeConversation(conversationId, () => void send());
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {}
      }, 25000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
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
