import { handleTelegramUpdate } from '@/lib/telegram-router';

export const runtime = 'nodejs';

// grammY/Telegram webhook. Secured by the secret token Telegram echoes in a header
// (set when registering the webhook). Delegates to the shared update handler.
export async function POST(req: Request) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (
    !process.env.TELEGRAM_WEBHOOK_SECRET ||
    secret !== process.env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response('forbidden', { status: 401 });
  }

  const update = await req.json().catch(() => null);
  if (update) await handleTelegramUpdate(update);
  return new Response('ok', { status: 200 });
}
