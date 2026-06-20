import { Bot } from 'grammy';
import { db, admins } from '@/lib/db';
import { isNotNull } from 'drizzle-orm';

// Lazy singleton bot. Returns null when no token is configured (dev fallback),
// so callers degrade to logging instead of throwing.
let bot: Bot | null | undefined;

export function getBot(): Bot | null {
  if (bot !== undefined) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  // TELEGRAM_API_ROOT lets Docker containers proxy outbound calls through the host
  // when direct access to api.telegram.org is blocked by the Docker NAT layer.
  const apiRoot = process.env.TELEGRAM_API_ROOT;
  bot = token
    ? new Bot(token, apiRoot ? { client: { apiRoot } } : undefined)
    : null;
  return bot;
}

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/**
 * Send a Telegram message to a private chat or a group topic.
 *
 * For group sends (with message_thread_id) callers SHOULD go through
 * enqueueGroupSend (group-send-queue.ts) to respect the per-group rate limit.
 * This function is kept as the low-level primitive and is also the path used
 * by the queue itself.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts?: { message_thread_id?: number }
): Promise<boolean> {
  const b = getBot();
  if (!b) {
    console.warn('[telegram] not configured — would send to', chatId, ':', text);
    return false;
  }
  try {
    await b.api.sendMessage(chatId, text, {
      message_thread_id: opts?.message_thread_id
    });
    return true;
  } catch (e) {
    console.error('[telegram] sendMessage failed:', e);
    return false;
  }
}

/**
 * Fetch a single chat member's status and rights.
 * Returns null on API error (e.g. bot not in chat, user not found).
 */
export async function getChatMember(
  chatId: string,
  userId: string | number
): Promise<Record<string, unknown> | null> {
  const b = getBot();
  if (!b) {
    console.warn('[telegram] not configured — getChatMember skipped');
    return null;
  }
  try {
    // grammY returns a ChatMember union type; cast to a plain record so callers
    // can inspect any field without importing grammY's union types.
    const member = await b.api.getChatMember(chatId, Number(userId));
    return member as unknown as Record<string, unknown>;
  } catch (e) {
    console.error('[telegram] getChatMember failed:', e);
    return null;
  }
}

/**
 * Fetch basic chat info (type, is_forum flag, etc.).
 * Returns null on API error.
 */
export async function getChat(
  chatId: string
): Promise<Record<string, unknown> | null> {
  const b = getBot();
  if (!b) {
    console.warn('[telegram] not configured — getChat skipped');
    return null;
  }
  try {
    const chat = await b.api.getChat(chatId);
    return chat as unknown as Record<string, unknown>;
  } catch (e) {
    console.error('[telegram] getChat failed:', e);
    return null;
  }
}

// ─── Forum topic wrappers (supergroup forum mode) ─────────────────────────

/**
 * Create a forum topic in a supergroup and return the message_thread_id.
 * Returns null on API error so callers can degrade gracefully.
 */
export async function createForumTopic(
  chatId: string,
  name: string
): Promise<number | null> {
  const b = getBot();
  if (!b) {
    console.warn('[telegram] not configured — createForumTopic skipped:', name);
    return null;
  }
  try {
    const result = await b.api.createForumTopic(chatId, name);
    return result.message_thread_id;
  } catch (e) {
    console.error('[telegram] createForumTopic failed:', e);
    return null;
  }
}

/**
 * Rename an existing forum topic. No-op on API error.
 * Returns true on success.
 */
export async function editForumTopic(
  chatId: string,
  threadId: number,
  name: string
): Promise<boolean> {
  const b = getBot();
  if (!b) {
    console.warn('[telegram] not configured — editForumTopic skipped');
    return false;
  }
  try {
    await b.api.editForumTopic(chatId, threadId, { name });
    return true;
  } catch (e) {
    // TOPIC_NOT_MODIFIED = the title already equals `name`. That's success for our
    // purposes (the topic shows the right title), not a failure — report true.
    if (e instanceof Error && /TOPIC_NOT_MODIFIED/.test(e.message)) {
      return true;
    }
    console.error('[telegram] editForumTopic failed:', e);
    return false;
  }
}

/**
 * Close a forum topic (marks it as resolved/archived in the group).
 * Returns true on success.
 */
export async function closeForumTopic(
  chatId: string,
  threadId: number
): Promise<boolean> {
  const b = getBot();
  if (!b) {
    console.warn('[telegram] not configured — closeForumTopic skipped');
    return false;
  }
  try {
    await b.api.closeForumTopic(chatId, threadId);
    return true;
  } catch (e) {
    console.error('[telegram] closeForumTopic failed:', e);
    return false;
  }
}

/**
 * React to a message with a single emoji (default 👍). Used to confirm an admin
 * takeover message was relayed to the customer. Telegram only allows a fixed set
 * of reaction emojis — 👍 is always valid. No-op on API error.
 */
export async function setMessageReaction(
  chatId: string,
  messageId: number,
  emoji: '👍' = '👍'
): Promise<boolean> {
  const b = getBot();
  if (!b) return false;
  try {
    await b.api.setMessageReaction(chatId, messageId, [
      { type: 'emoji', emoji }
    ]);
    return true;
  } catch (e) {
    console.error('[telegram] setMessageReaction failed:', e);
    return false;
  }
}

// Fan a notification out to every admin who has linked their Telegram account.
export async function sendToLinkedAdmins(text: string): Promise<number> {
  const rows = await db
    .select({ telegram_user_id: admins.telegram_user_id })
    .from(admins)
    .where(isNotNull(admins.telegram_user_id));
  let sent = 0;
  for (const r of rows) {
    if (r.telegram_user_id && (await sendTelegramMessage(r.telegram_user_id, text)))
      sent++;
  }
  return sent;
}
