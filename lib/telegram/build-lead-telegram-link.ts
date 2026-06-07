import { getBot } from '@/lib/telegram';

export type LeadTelegramLinkInfo = {
  token: string;
  command: string;
  deepLink: string | null;
  configured: boolean;
};

/** Build deep link + /start command for linking a web thread to Telegram. */
export async function buildLeadTelegramLinkInfo(
  token: string
): Promise<LeadTelegramLinkInfo> {
  const bot = getBot();
  let deepLink: string | null = null;

  if (bot) {
    try {
      const me = await bot.api.getMe();
      if (me.username) {
        deepLink = `https://t.me/${me.username}?start=${token}`;
      }
    } catch (e) {
      console.error('[telegram] getMe failed:', e);
    }
  }

  return {
    token,
    command: `/start ${token}`,
    deepLink,
    configured: !!bot
  };
}
