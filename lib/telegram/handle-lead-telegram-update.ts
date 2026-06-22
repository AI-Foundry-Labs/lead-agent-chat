/**
 * Main Telegram update dispatcher.
 *
 * Branches by update kind / chat.type:
 *   my_chat_member   → bot promoted to admin → auto-bind group to agency
 *   private          → handle-private-telegram-message.ts (admin/lead DM flows)
 *   group/supergroup → single master agent:
 *       /link <token>  → bind group to agency + create 🛠 Master topic (fallback)
 *       any thread     → handleMasterTopicMessage (main_assistant + slash commands)
 *
 * Single-topic UX: no per-lead topics — every group message routes to the one
 * master agent. Echo-loop safety: is_bot filter + idempotency by update_id.
 */

import { consumeAgencyTelegramLink } from '@/lib/auth';
import { getAgencyByTelegramGroup, getAgencyById } from '@/lib/db';
import { getAdminByTelegramUserId } from '@/lib/db/telegram-links';
import { sendTelegramMessage, getBot } from '@/lib/telegram';
import {
  bindAgencyGroupAndEnsureMaster,
  handleBotPromotedToAdmin
} from '@/lib/telegram/bind-agency-group';
import {
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
  // Token resolved the agency; the shared helper handles verify + bind + Master.
  await bindAgencyGroupAndEnsureMaster(
    agencyId,
    chat as unknown as Record<string, unknown>,
    await getBotId()
  );
}

// ─── Main dispatcher ───────────────────────────────────────────────────────

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  opts: { silent?: boolean } = {}
): Promise<'admin' | 'lead' | 'group' | 'unlinked' | 'ignored'> {
  // ── MY_CHAT_MEMBER branch (bot membership/rights changed) ─────────────────
  // When the bot is promoted to admin in a supergroup, auto-bind the group to
  // the agency of whoever promoted it (no /link token required).
  if (update.my_chat_member) {
    // Fan-out extras skip auto-bind: only the primary instance binds groups, so
    // we don't double-create the Master topic across instances.
    if (!opts.silent) await handleBotPromotedToAdmin(update, await getBotId());
    return 'group';
  }

  // ── CALLBACK_QUERY branch (inline-keyboard taps) ──────────────────────────
  // Inline-keyboard taps arrive as callback_query, not message.
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = String(cq.message?.chat?.id ?? '');
    const threadId = cq.message?.message_thread_id;
    const data = cq.data ?? '';
    const fromId = cq.from?.id != null ? String(cq.from.id) : '';
    const agency = chatId ? await getAgencyByTelegramGroup(chatId) : null;
    // Single-topic UX: handle the /agent inline-keyboard tap wherever it was
    // posted (General or any thread) — reply goes back to that same thread.
    if (agency) {
      await handleAgentCallback(chatId, agency, fromId, data, threadId, cq.id);
      return 'group';
    }
    // DM mode: callback from a linked admin's private chat.
    if (fromId) {
      const adminRow = await getAdminByTelegramUserId(fromId);
      if (adminRow) {
        const dmAgency = await getAgencyById(adminRow.agency_id);
        if (dmAgency) {
          const dmSend = (msg: string) => void sendTelegramMessage(chatId, msg);
          await handleAgentCallback(chatId, dmAgency, fromId, data, undefined, cq.id, dmSend);
          return 'admin';
        }
      }
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

    // Single-topic UX: the group has exactly one master agent. Every thread
    // (🛠 Master, General, or any other) routes to the master assistant — there
    // are no per-lead topics anymore, so the bot is never silent on a command.
    await handleMasterTopicMessage(chatId, agency, fromId, text, msg.message_thread_id);
    return 'group';
  }

  // ── PRIVATE branch ────────────────────────────────────────────────────────
  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1];
    console.log(`[telegram] /start token=${token ?? '(none)'} silent=${opts.silent ?? false}`);
    if (!token) {
      if (opts.silent) return 'ignored';
      return sendStartNoTokenReply(chatId, fromId);
    }
    const adminOk = await handleAdminStart(chatId, token);
    console.log(`[telegram] handleAdminStart result=${adminOk}`);
    if (adminOk) return 'admin';
    const leadOk = await handleLeadStart(chatId, fromId, token);
    console.log(`[telegram] handleLeadStart result=${leadOk}`);
    if (leadOk) return 'lead';
    // silent mode: token not in this instance's DB — let primary handle the error reply
    if (opts.silent) return 'unlinked';
    await sendTelegramMessage(chatId, '❌ Lien invalide ou expiré.');
    return 'unlinked';
  }

  if (await handleAdminMessage(chatId, fromId, text)) return 'admin';
  if (await handleLeadMessage(fromId, text)) return 'lead';

  if (opts.silent) return 'unlinked';
  await sendUnlinkedReply(chatId);
  return 'unlinked';
}
