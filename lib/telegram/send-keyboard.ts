/**
 * Low-level helper to send a Telegram message with an inline keyboard.
 * Mirrors sendTelegramMessage from lib/telegram.ts but adds reply_markup support.
 * Uses the grammy Bot singleton (getBot) — same pattern as the rest of the codebase.
 */

import { getBot } from '@/lib/telegram';

export async function sendTelegramKeyboard(
  chatId: string,
  text: string,
  keyboard: { inline_keyboard: { text: string; callback_data: string }[][] },
  threadId?: number
): Promise<boolean> {
  const b = getBot();
  if (!b) {
    console.warn('[telegram] not configured — sendTelegramKeyboard skipped for', chatId);
    return false;
  }
  try {
    await b.api.sendMessage(chatId, text, {
      message_thread_id: threadId,
      reply_markup: keyboard
    });
    return true;
  } catch (e) {
    console.error('[telegram] sendTelegramKeyboard failed:', e);
    return false;
  }
}
