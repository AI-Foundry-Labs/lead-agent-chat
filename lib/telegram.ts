import { Bot } from 'grammy';
import { db, admins } from '@/lib/db';
import { isNotNull } from 'drizzle-orm';

// Lazy singleton bot. Returns null when no token is configured (dev fallback),
// so callers degrade to logging instead of throwing.
let bot: Bot | null | undefined;

export function getBot(): Bot | null {
  if (bot !== undefined) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  bot = token ? new Bot(token) : null;
  return bot;
}

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<boolean> {
  const b = getBot();
  if (!b) {
    console.warn('[telegram] not configured — would send to', chatId, ':', text);
    return false;
  }
  try {
    await b.api.sendMessage(chatId, text);
    return true;
  } catch (e) {
    console.error('[telegram] sendMessage failed:', e);
    return false;
  }
}

// Fan a notification out to every admin who has linked their Telegram account.
export async function sendToLinkedAdmins(text: string): Promise<number> {
  const rows = await db
    .select({ telegram_user_id: admins.telegram_user_id })
    .from(admins)
    .where(isNotNull(admins.telegram_user_id));
  let sent = 0;
  for (const r of rows) {
    if (r.telegram_user_id && (await sendTelegramMessage(r.telegram_user_id, text)))
      sent++;
  }
  return sent;
}
