import { telegramConfigured } from '@/lib/telegram';
import { getBotUsername, buildTelegramStartLink } from './get-bot-username';

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
  const username = await getBotUsername();
  const deepLink = username ? buildTelegramStartLink(username, token) : null;

  return {
    token,
    command: `/start ${token}`,
    deepLink,
    configured: telegramConfigured()
  };
}
