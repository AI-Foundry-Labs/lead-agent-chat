import { requireAdmin, issueTelegramLinkToken, toAuthResponse } from '@/lib/auth';
import { getBot } from '@/lib/telegram';

export const runtime = 'nodejs';

// Issue a single-use, short-lived token the admin pastes into Telegram:
//   /start <token>
export async function POST() {
  try {
    const admin = await requireAdmin();
    const token = await issueTelegramLinkToken(admin.id);
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

    return Response.json({
      token,
      command: `/start ${token}`,
      deep_link: deepLink,
      configured: !!bot
    });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}
