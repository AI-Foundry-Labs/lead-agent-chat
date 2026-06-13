import { requireAdmin, issueAgencyTelegramLinkToken, toAuthResponse } from '@/lib/auth';
import { telegramConfigured } from '@/lib/telegram';

export const runtime = 'nodejs';

/**
 * POST /api/admin/link-telegram
 *
 * Issues a single-use, 10-minute agency-scoped token. The admin must paste the
 * returned `/link <token>` command INSIDE the agency Telegram supergroup (not as
 * a DM). The bot reads `chat.id` from that group message to bind the group.
 *
 * Setup checklist returned in `instructions`:
 *  1. Create a Telegram supergroup and enable Topics (Settings → Topics).
 *  2. Add the bot as an admin with "Manage Topics" permission.
 *  3. Send the command below INSIDE that group (not as a private message).
 */
export async function POST() {
  try {
    const admin = await requireAdmin();
    const token = await issueAgencyTelegramLinkToken(admin.agency_id);

    return Response.json({
      token,
      command: `/link ${token}`,
      instructions: [
        '1. Créez un supergroupe Telegram et activez les Sujets (Paramètres → Sujets).',
        '2. Ajoutez le bot comme administrateur avec la permission « Gérer les sujets ».',
        '3. Envoyez la commande ci-dessus DANS ce groupe (pas en message privé).',
        '---',
        '1. Create a Telegram supergroup and enable Topics (Settings → Topics).',
        '2. Add the bot as admin with "Manage Topics" permission.',
        '3. Send the command above INSIDE that group (not as a private message).'
      ],
      configured: telegramConfigured()
    });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}
