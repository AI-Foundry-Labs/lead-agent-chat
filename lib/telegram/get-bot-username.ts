import { getBot } from '@/lib/telegram';

let cachedUsername: string | null | undefined;

/**
 * Resolve bot username from env (fast, no API call) or via getMe().
 * Returns null when Telegram is not configured.
 */
export async function getBotUsername(): Promise<string | null> {
  // Env var is the preferred source — avoids a round-trip on every link generation.
  const envUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
  if (envUsername) return envUsername;

  if (cachedUsername !== undefined) return cachedUsername;

  const bot = getBot();
  if (!bot) {
    cachedUsername = null;
    return null;
  }
  try {
    const me = await bot.api.getMe();
    cachedUsername = me.username ?? null;
  } catch (e) {
    console.error('[telegram] getMe failed:', e);
    cachedUsername = null;
  }
  return cachedUsername;
}

/** Build a Telegram deep link that opens the bot and sends /start <token>. */
export function buildTelegramStartLink(username: string, token: string): string {
  // tg:// opens the native app directly; https://t.me/ falls back to web.
  // We use https://t.me/ because it works on both desktop & mobile and Telegram
  // auto-redirects to the app when installed.
  return `https://t.me/${username}?start=${token}`;
}
