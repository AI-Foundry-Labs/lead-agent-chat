/**
 * Main Telegram update dispatcher.
 *
 * Branches on chat.type:
 *   private  → handle-private-telegram-message.ts (admin/lead DM flows)
 *   group/supergroup → group routing:
 *       /link <token>          → bind group to agency + create 🛠 Master topic
 *       Master topic           → main_assistant config agent (Phase 01)
 *       Topic 2 (assistant)    → operator copilot turn (can send_reply to lead)
 *       Topic 1 (conversation) → read-only mirror; typing → pointer to 🤖
 *       general / unknown      → ignore
 *
 * Echo-loop safety: is_bot filter + idempotency by update_id.
 */

import { consumeAgencyTelegramLink } from '@/lib/auth';
import { getAgencyByTelegramGroup, bindTelegramGroupToAgency, setAgencyMasterTopic } from '@/lib/db';
import { sendTelegramMessage, getBot, createForumTopic } from '@/lib/telegram';
import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { verifyAgencyGroup } from '@/lib/telegram/verify-agency-group';
import { routeGroupMessage } from '@/lib/telegram/route-group-message';
import {
  handleOperatorTopicMessage,
  handleConversationTopicMessage,
  handleMasterTopicMessage,
  handleAgentCallback
} from '@/lib/telegram/handle-group-telegram-message';
import {
  handleAdminStart,
  handleLeadStart,
  handleAdminMessage,
  handleLeadMessage,
  sendUnlinkedReply,
  sendStartNoTokenReply
} from '@/lib/telegram/handle-private-telegram-message';
import type { TelegramUpdate } from '@/lib/telegram-router-types';

// ─── Idempotency deduplication (red-team I1) ──────────────────────────────
// Bounded LRU set of seen update_ids. Telegram resends on webhook timeout.

const SEEN_UPDATE_MAX = 2_000;
const seenUpdateIds = new Set<number>();
const seenUpdateIdQueue: number[] = [];

function markSeen(updateId: number): boolean {
  if (seenUpdateIds.has(updateId)) return true;
  seenUpdateIds.add(updateId);
  seenUpdateIdQueue.push(updateId);
  if (seenUpdateIdQueue.length > SEEN_UPDATE_MAX) {
    seenUpdateIds.delete(seenUpdateIdQueue.shift()!);
  }
  return false;
}

// ─── Cached bot id for verifyAgencyGroup ──────────────────────────────────

let cachedBotId: number | undefined;

async function getBotId(): Promise<number | undefined> {
  if (cachedBotId !== undefined) return cachedBotId;
  const bot = getBot();
  if (!bot) return undefined;
  try {
    cachedBotId = (await bot.api.getMe()).id;
  } catch {
    // non-fatal — verifyAgencyGroup degrades gracefully
  }
  return cachedBotId;
}

// ─── Group: /link handler ─────────────────────────────────────────────────

async function handleAgencyGroupLink(
  chat: NonNullable<TelegramUpdate['message']>['chat'] & object,
  token: string
): Promise<void> {
  const chatId = String((chat as Record<string, unknown>).id);
  const agencyId = await consumeAgencyTelegramLink(token);
  if (!agencyId) {
    await sendTelegramMessage(
      chatId,
      "❌ Token invalide ou expiré. Demandez un nouveau code depuis l'interface web.\n" +
      '❌ Invalid or expired token. Request a new code from the web interface.'
    );
    return;
  }
  const result = await verifyAgencyGroup(
    chat as unknown as Record<string, unknown>,
    await getBotId()
  );
  if (!result.ok) {
    await sendTelegramMessage(chatId, `❌ ${result.reason}`);
    return;
  }
  await bindTelegramGroupToAgency(agencyId, chatId);

  // Create the 🛠 Master topic if it doesn't exist yet (idempotent).
  // We need the agency row to check whether it's already been set.
  const agency = await getAgencyByTelegramGroup(chatId);
  if (agency && agency.telegram_master_topic_id === null) {
    const threadId = await createForumTopic(chatId, `🛠 Master — ${agency.name}`);
    if (threadId !== null) {
      await setAgencyMasterTopic(agencyId, threadId);
      void enqueueGroupSend(
        chatId,
        "🛠 Topic Master prêt — envoyez un message ici pour configurer l'agence " +
        '(critères, annonces, règles).\n' +
        '🛠 Master topic ready — message here to configure the agency ' +
        '(criteria, listings, rules).',
        { threadId, kind: 'critical' }
      );
    } else {
      console.warn('[group] createForumTopic failed for agency', agencyId, '— master topic not created');
    }
  }

  await sendTelegramMessage(
    chatId,
    "✅ Groupe lié à l'agence. Le bot est prêt à créer des fils par lead.\n" +
    '✅ Group linked to the agency. The bot is ready to create per-lead topics.\n\n' +
    'Prochaines étapes / Next steps:\n' +
    '• Les nouveaux leads déclencheront automatiquement la création de sujets.\n' +
    '• New leads will automatically trigger topic creation.'
  );
}

// ─── Main dispatcher ───────────────────────────────────────────────────────

export async function handleTelegramUpdate(
  update: TelegramUpdate
): Promise<'admin' | 'lead' | 'group' | 'unlinked' | 'ignored'> {
  // ── CALLBACK_QUERY branch (inline-keyboard taps) ──────────────────────────
  // Inline-keyboard taps arrive as callback_query, not message.
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = String(cq.message?.chat?.id ?? '');
    const threadId = cq.message?.message_thread_id;
    const data = cq.data ?? '';
    const fromId = cq.from?.id != null ? String(cq.from.id) : '';
    const agency = chatId ? await getAgencyByTelegramGroup(chatId) : null;
    if (
      agency &&
      agency.telegram_master_topic_id !== null &&
      threadId === agency.telegram_master_topic_id
    ) {
      await handleAgentCallback(chatId, agency, fromId, data, threadId);
      return 'group';
    }
    return 'ignored';
  }

  const msg = update?.message;
  const text = msg?.text;
  const fromId = msg?.from?.id != null ? String(msg.from.id) : null;
  const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
  if (!text || !fromId || !chatId) return 'ignored';

  const chatType = msg?.chat?.type ?? 'private';
  const isGroup = chatType === 'group' || chatType === 'supergroup';

  // ── GROUP branch ──────────────────────────────────────────────────────────
  if (isGroup) {
    if (text.startsWith('/link ')) {
      const token = text.split(/\s+/)[1];
      if (token) { await handleAgencyGroupLink(msg.chat!, token); return 'group'; }
    }

    const agency = await getAgencyByTelegramGroup(chatId);
    if (!agency) return 'ignored';

    // Echo filter: ignore the bot's own mirror posts to prevent re-ingestion.
    if (msg.from?.is_bot === true) return 'ignored';

    // Idempotency: drop Telegram webhook retries.
    const updateId = update.update_id;
    if (updateId !== undefined && markSeen(updateId)) {
      console.warn('[group] duplicate update_id', updateId, '— skipping');
      return 'ignored';
    }

    // 🛠 Master topic: check BEFORE per-lead routing (master id not in lead_telegram_topics).
    if (
      agency.telegram_master_topic_id !== null &&
      msg.message_thread_id === agency.telegram_master_topic_id
    ) {
      await handleMasterTopicMessage(chatId, agency, fromId, text, msg.message_thread_id);
      return 'group';
    }

    const route = await routeGroupMessage(chatId, msg.message_thread_id);

    if (route.kind === 'topic2_assistant' && route.mapping) {
      await handleOperatorTopicMessage(chatId, route.mapping, fromId, text);
      return 'group';
    }
    if (route.kind === 'topic1_conversation' && route.mapping) {
      await handleConversationTopicMessage(chatId, route.mapping);
      return 'group';
    }
    return 'ignored'; // general / unknown thread
  }

  // ── PRIVATE branch ────────────────────────────────────────────────────────
  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1];
    if (!token) return sendStartNoTokenReply(chatId, fromId);
    if (await handleAdminStart(chatId, token)) return 'admin';
    if (await handleLeadStart(chatId, fromId, token)) return 'lead';
    await sendTelegramMessage(chatId, '❌ Lien invalide ou expiré.');
    return 'unlinked';
  }

  if (await handleAdminMessage(chatId, fromId, text)) return 'admin';
  if (await handleLeadMessage(fromId, text)) return 'lead';

  await sendUnlinkedReply(chatId);
  return 'unlinked';
}
