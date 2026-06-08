import { requireAdmin, issueTelegramLinkToken, toAuthResponse } from '@/lib/auth';
import { telegramConfigured } from '@/lib/telegram';
import { getBotUsername, buildTelegramStartLink } from '@/lib/telegram/get-bot-username';

export const runtime = 'nodejs';

// Issue a single-use, short-lived token the admin sends to the bot via /start <token>
export async function POST() {
  try {
    const admin = await requireAdmin();
    const token = await issueTelegramLinkToken(admin.id);
    const username = await getBotUsername();
    const deepLink = username ? buildTelegramStartLink(username, token) : null;

    return Response.json({
      token,
      command: `/start ${token}`,
      deep_link: deepLink,
      configured: telegramConfigured()
    });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}
