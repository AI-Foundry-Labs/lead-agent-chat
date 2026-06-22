/**
 * Shared agency-group binding logic.
 *
 * Two entry points converge here:
 *   - /link <token>            → handleAgencyGroupLink (token resolves the agency)
 *   - bot promoted to admin    → handleBotPromotedToAdmin (adder resolves the agency)
 *
 * Both end by binding the group to an agency and ensuring the 🛠 Master topic
 * exists, so that single flow lives in bindAgencyGroupAndEnsureMaster (DRY).
 */

import {
  getAgencyByTelegramGroup,
  bindTelegramGroupToAgency,
  setAgencyMasterTopic
} from '@/lib/db';
import { getAdminByTelegramUserId } from '@/lib/db/telegram-links';
import { sendTelegramMessage, createForumTopic, closeForumTopic } from '@/lib/telegram';
import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { verifyAgencyGroup } from '@/lib/telegram/verify-agency-group';
import type { TelegramUpdate } from '@/lib/telegram-router-types';

type ChatLike = Record<string, unknown>;

/**
 * Verify the group, bind it to the agency, and create the 🛠 Master topic if it
 * doesn't exist yet. Posts a confirmation message on success.
 *
 * Returns true when the group is bound (or was already bound) to the agency.
 * On verification failure, posts the reason to the group and returns false.
 */
export async function bindAgencyGroupAndEnsureMaster(
  agencyId: string,
  chat: ChatLike,
  botUserId?: string | number
): Promise<boolean> {
  const chatId = String(chat.id);

  const result = await verifyAgencyGroup(chat, botUserId);
  if (!result.ok) {
    await sendTelegramMessage(chatId, `❌ ${result.reason}`);
    return false;
  }

  await bindTelegramGroupToAgency(agencyId, chatId);

  // Create the 🛠 Master topic if it doesn't exist yet.
  const agency = await getAgencyByTelegramGroup(chatId);
  if (agency && agency.telegram_master_topic_id === null) {
    const threadId = await createForumTopic(chatId, `🛠 Master — ${agency.name}`);
    if (threadId !== null) {
      // Atomic claim: my_chat_member events aren't deduped by update_id and may
      // fire concurrently/on retry, so two calls can both reach here. Only the
      // call that wins the conditional UPDATE keeps its topic; the loser closes
      // its orphan so the group isn't left with duplicate Master topics.
      const claimed = await setAgencyMasterTopic(agencyId, threadId);
      if (claimed) {
        void enqueueGroupSend(
          chatId,
          "🛠 Topic Master prêt — envoyez un message ici pour configurer l'agence " +
            '(critères, annonces, règles).\n' +
            '🛠 Master topic ready — message here to configure the agency ' +
            '(criteria, listings, rules).',
          { threadId, kind: 'critical' }
        );
      } else {
        await closeForumTopic(chatId, threadId).catch(() => {});
      }
    } else {
      console.warn(
        '[group] createForumTopic failed for agency',
        agencyId,
        '— master topic not created'
      );
      // Half-bound: group is bound but the Master topic couldn't be created
      // (usually missing "Manage Topics" right or Topics disabled). Tell the
      // admin how to fix it instead of leaving the group silently broken.
      await sendTelegramMessage(
        chatId,
        '⚠️ Groupe lié, mais le sujet 🛠 Master n’a pas pu être créé. ' +
          'Activez les Sujets et donnez au bot la permission « Gérer les sujets », ' +
          'puis renvoyez /link <token>.\n' +
          '⚠️ Group linked, but the 🛠 Master topic could not be created. ' +
          'Enable Topics and grant the bot "Manage Topics", then re-send /link <token>.'
      );
    }
  }

  await sendTelegramMessage(
    chatId,
    "✅ Groupe lié à l’agence.\n\nTout se passe dans le sujet 🛠 Master :\n• Écrivez du texte pour discuter avec l’assistant.\n• /help pour voir les commandes (/agent, /leads, /lead_history, /pool…)."
  );
  return true;
}

/**
 * Pure guard: is this a genuine promotion of the bot INTO admin in a supergroup?
 *
 * True only for a member→admin transition in a supergroup — filters out demotions,
 * no-op rights changes (admin→admin), and non-supergroup chats so the same event
 * firing repeatedly doesn't re-trigger auto-bind. No I/O — unit-testable.
 */
export function isBotPromotionToAdmin(args: {
  chatType?: string;
  oldStatus?: string;
  newStatus?: string;
}): boolean {
  if (args.chatType !== 'supergroup') return false;
  const isNowAdmin =
    args.newStatus === 'administrator' || args.newStatus === 'creator';
  const wasAdmin =
    args.oldStatus === 'administrator' || args.oldStatus === 'creator';
  return isNowAdmin && !wasAdmin;
}

/**
 * Handle a `my_chat_member` update where the bot was promoted to admin in a
 * supergroup. Resolves the agency via the user who promoted the bot
 * (from.id → linked admin → agency_id) and auto-binds without a token.
 *
 * No-ops unless this is a genuine member→admin transition (guards against the
 * same event firing repeatedly on unrelated rights changes).
 */
export async function handleBotPromotedToAdmin(
  update: TelegramUpdate,
  botUserId?: string | number
): Promise<void> {
  const ev = update.my_chat_member;
  if (!ev?.chat) return;

  const chat = ev.chat;
  if (
    !isBotPromotionToAdmin({
      chatType: chat.type,
      oldStatus: ev.old_chat_member?.status,
      newStatus: ev.new_chat_member?.status
    })
  ) {
    return;
  }

  const chatId = String(chat.id);
  const fromId = ev.from?.id != null ? String(ev.from.id) : null;

  // If the group is already bound, just ensure the Master topic exists.
  const existing = await getAgencyByTelegramGroup(chatId);
  if (existing) {
    await bindAgencyGroupAndEnsureMaster(
      existing.id,
      chat as ChatLike,
      botUserId
    );
    return;
  }

  if (!fromId) return;

  const admin = await getAdminByTelegramUserId(fromId);
  if (!admin) {
    await sendTelegramMessage(
      chatId,
      "👋 Bot ajouté comme administrateur, mais votre compte Telegram n’est pas encore lié à une agence.\n" +
        "  • Liez-le : envoyez /start <token> au bot en privé (token depuis l’interface web),\n" +
        '  • puis renvoyez la commande /link <token> ici.\n\n' +
        '👋 Bot added as admin, but your Telegram account is not linked to an agency yet.\n' +
        '  • Link it: DM the bot /start <token> (token from the web app),\n' +
        '  • then re-send /link <token> here.'
    );
    return;
  }

  await bindAgencyGroupAndEnsureMaster(admin.agency_id, chat as ChatLike, botUserId);
}
