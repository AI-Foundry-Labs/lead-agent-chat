import { requireAdmin, toAuthResponse } from '@/lib/auth';
import { subscribeAgencyData } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  let adminAgencyId: string;
  try {
    const admin = await requireAdmin();
    adminAgencyId = admin.agency_id;
  } catch (e) {
    return toAuthResponse(e) ?? new Response('unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = () => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'agency-data', ts: Date.now() })}\n\n`)
          );
        } catch {}
      };

      const unsubscribe = subscribeAgencyData(adminAgencyId, send);
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
