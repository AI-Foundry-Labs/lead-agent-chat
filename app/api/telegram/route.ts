import crypto from 'node:crypto';
import { handleTelegramUpdate } from '@/lib/telegram-router';

export const runtime = 'nodejs';

/**
 * grammY/Telegram webhook. Secured by the secret token Telegram echoes in
 * x-telegram-bot-api-secret-token (set when registering the webhook).
 *
 * Uses crypto.timingSafeEqual to prevent timing-side-channel attacks.
 * Length guard first: mismatched lengths return immediately without equal call
 * (equal() requires same-length Buffers).
 */
export async function POST(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const received = req.headers.get('x-telegram-bot-api-secret-token') ?? '';

  const valid =
    !!expected &&
    expected.length === received.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));

  if (!valid) {
    return new Response('forbidden', { status: 401 });
  }

  const update = await req.json().catch(() => null);
  if (update) await handleTelegramUpdate(update);
  return new Response('ok', { status: 200 });
}
