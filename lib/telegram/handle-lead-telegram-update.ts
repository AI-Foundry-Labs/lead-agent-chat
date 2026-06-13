/**
 * Main Telegram update dispatcher.
 *
 * Branches on chat.type:
 *   private  → handle-private-telegram-message.ts (admin/lead DM flows)
 *   group/supergroup → group routing (Phase 04):
 *       /link <token>          → bind group to agency (Phase 02)
 *       Topic 2 (assistant)    → operator copilot turn (can send_reply to lead)
 *       Topic 1 (conversation) → read-only mirror; typing → pointer to 🤖
 *       general / unknown      → ignore
 *
 * Echo-loop safety: is_bot filter + idempotency by update_id.
 */

import { consumeAgencyTelegramLink } from '@/lib/auth';
import { getAgencyByTelegramGroup, bindTelegramGroupToAgency } from '@/lib/db';
import { sendTelegramMessage, getBot } from '@/lib/telegram';
import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { verifyAgencyGroup } from '@/lib/telegram/verify-agency-group';
import { resolveActingAdmin } from '@/lib/telegram/resolve-agency-admin';
import { routeGroupMessage } from '@/lib/telegram/route-group-message';
import { runAgentTurn } from '@/lib/agent/run';
import {
  handleAdminStart,
  handleLeadStart,
  handleAdminMessage,
  handleLeadMessage,
  sendUnlinkedReply,
  sendStartNoTokenReply
} from '@/lib/telegram/handle-private-telegram-message';
import type { TelegramUpdate } from '@/lib/telegram-router-types';
import type { LeadTelegramTopics } from '@/lib/db/lead-telegram-topics';

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

// ─── Group handlers ────────────────────────────────────────────────────────

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
  await sendTelegramMessage(
    chatId,
    "✅ Groupe lié à l'agence. Le bot est prêt à créer des fils par lead.\n" +
    '✅ Group linked to the agency. The bot is ready to create per-lead topics.\n\n' +
    'Prochaines étapes / Next steps:\n' +
    '• Les nouveaux leads déclencheront automatiquement la création de sujets.\n' +
    '• New leads will automatically trigger topic creation.'
  );
}

/**
 * Topic 2 (🤖 Assistant): operator copilot turn.
 * Unmapped sender → bilingual rejection (red-team C2 — no silent fallback).
 * Reply posted into Topic 2 ONLY via kind:'critical' queue entry.
 */
async function handleOperatorTopicMessage(
  chatId: string,
  mapping: LeadTelegramTopics,
  fromId: string,
  text: string
): Promise<void> {
  if (!mapping.operator_conversation_id) {
    console.warn('[group] Topic 2: no operator_conversation_id for lead', mapping.lead_id);
    return;
  }
  // Group is agency-private → any member is trusted; attribute to the sender's
  // linked admin or fall back to the agency's primary admin.
  const admin = await resolveActingAdmin(fromId, mapping.agency_id);
  if (!admin) {
    void enqueueGroupSend(
      chatId,
      '❌ Aucun administrateur trouvé pour cette agence.\n' +
      '❌ No admin found for this agency.',
      { threadId: mapping.assistant_topic_id, kind: 'critical' }
    );
    return;
  }
  const result = await runAgentTurn(
    mapping.operator_conversation_id,
    text,
    { type: 'operator', leadId: mapping.lead_id, adminId: admin.id, adminName: admin.name }
  );
  if (result.reply.trim()) {
    // Post into Topic 2 only — dispatchReply skips 'operator' type so the
    // customer channel is never touched.
    void enqueueGroupSend(chatId, result.reply, {
      threadId: mapping.assistant_topic_id,
      kind: 'critical'
    });
  }
}

/**
 * Topic 1 (💬 Conversation): READ-ONLY mirror of the lead↔agent conversation.
 *
 * This topic only shows the conversation (🧑 Lead / 🤖 Agent / 🧑‍💼 Conseiller).
 * Admins do NOT reply here — to message the customer they either give the agent
 * an instruction in the 🤖 Assistant topic (which calls send_reply) or use the
 * web /admin interface. A message typed here just gets a pointer back to 🤖.
 */
async function handleConversationTopicMessage(
  chatId: string,
  mapping: LeadTelegramTopics
): Promise<void> {
  void enqueueGroupSend(
    chatId,
    'ℹ️ Ce fil affiche seulement la conversation. Pour répondre au client, ' +
    'donnez la consigne à l’assistant dans le sujet 🤖 Assistant, ou utilisez l’interface web.\n' +
    'ℹ️ This thread only shows the conversation. To reply to the customer, instruct the ' +
    'assistant in the 🤖 Assistant topic, or use the web interface.',
    { threadId: mapping.conversation_topic_id, kind: 'critical' }
  );
}

// ─── Main dispatcher ───────────────────────────────────────────────────────

export async function handleTelegramUpdate(
  update: TelegramUpdate
): Promise<'admin' | 'lead' | 'group' | 'unlinked' | 'ignored'> {
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
