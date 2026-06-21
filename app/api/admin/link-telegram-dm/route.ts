import { requireAdmin, issueTelegramLinkToken, toAuthResponse } from '@/lib/auth';
import { telegramConfigured } from '@/lib/telegram';
import { getBotUsername, buildTelegramStartLink } from '@/lib/telegram/get-bot-username';

export const runtime = 'nodejs';

/**
 * POST /api/admin/link-telegram-dm
 *
 * Issues a single-use, 10-minute admin-scoped token. The admin sends
 * /start <token> to the bot in a private DM — no supergroup required.
 *
 * Flow:
 *   1. Admin clicks "Lier Telegram" → this endpoint returns a deep link.
 *   2. Admin opens the deep link (or copies /start <token>) → DM with bot.
 *   3. Bot calls handleAdminStart() → binds admins.telegram_user_id.
 *   4. From then on the admin can DM the bot for commands + main assistant.
 */
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
