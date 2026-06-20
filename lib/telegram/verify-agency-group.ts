import { getChatMember, getChat } from '@/lib/telegram';

export type VerifyGroupResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verify that the chat is a supergroup with Topics enabled and the bot has
 * the `can_manage_topics` admin right.
 *
 * Callers pass `chat` from the Telegram update (partial shape is fine) and the
 * bot's own Telegram user id. When botUserId is not provided the function still
 * checks chat type + is_forum, but skips the bot-rights check.
 */
export async function verifyAgencyGroup(
  chat: Record<string, unknown>,
  botUserId?: string | number
): Promise<VerifyGroupResult> {
  // 1. Chat type must be supergroup
  if (chat.type !== 'supergroup') {
    return {
      ok: false,
      reason:
        'Ce groupe doit être un supergroupe Telegram avec les Sujets activés.\n' +
        'This group must be a Telegram supergroup with Topics enabled.'
    };
  }

  // 2. Topics (is_forum) must be enabled. The partial update `chat` object may
  //    not carry is_forum; fetch full info via getChat to be sure.
  const chatId = String(chat.id);
  const fullChat = await getChat(chatId);

  if (!fullChat?.is_forum) {
    return {
      ok: false,
      reason:
        'Les Sujets ne sont pas activés sur ce groupe. ' +
        'Activez-les dans Paramètres → Sujets, puis réessayez.\n' +
        'Topics are not enabled on this group. ' +
        'Enable them in Settings → Topics, then try again.'
    };
  }

  // 3. Bot must be an admin with can_manage_topics
  if (botUserId !== undefined) {
    const member = await getChatMember(chatId, botUserId);
    if (!member) {
      return {
        ok: false,
        reason:
          'Impossible de vérifier les droits du bot dans ce groupe. ' +
          'Assurez-vous que le bot est administrateur, puis réessayez.\n' +
          'Could not verify bot rights in this group. ' +
          'Make sure the bot is an admin, then try again.'
      };
    }

    const isAdmin =
      member.status === 'administrator' || member.status === 'creator';
    const canManageTopics = Boolean(member.can_manage_topics);

    if (!isAdmin || !canManageTopics) {
      return {
        ok: false,
        reason:
          'Le bot doit être administrateur avec la permission « Gérer les sujets ».\n' +
          '  1. Ouvrez les paramètres du groupe → Administrateurs.\n' +
          '  2. Ajoutez le bot et activez « Gérer les sujets ».\n' +
          '  3. Renvoyez la commande /link <token>.\n' +
          'The bot must be an admin with the "Manage Topics" permission.\n' +
          '  1. Open group settings → Administrators.\n' +
          '  2. Add the bot and enable "Manage Topics".\n' +
          '  3. Re-send the /link <token> command.'
      };
    }
  }

  return { ok: true };
}
