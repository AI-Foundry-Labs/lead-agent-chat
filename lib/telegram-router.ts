import { consumeTelegramLink } from '@/lib/auth';
import {
  bindTelegramToAdmin,
  getAdminByTelegramUserId,
  getOrCreateAdminAssistant
} from '@/lib/db';
import { sendTelegramMessage } from '@/lib/telegram';
import { runAgentTurn } from '@/lib/agent/run';

// Minimal shape we read from a Telegram update — shared by the webhook route and
// the local long-polling dev runner so the behaviour is identical.
export interface TelegramUpdate {
  message?: {
    text?: string;
    from?: { id?: number | string };
    chat?: { id?: number | string };
  };
}

// Handle one Telegram message: /start <token> links the chat to an admin; any
// other text from a linked admin is routed into their assistant conversation
// (the reply is dispatched back to this chat by runAgentTurn → dispatchReply).
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update?.message;
  const text = msg?.text;
  const fromId = msg?.from?.id != null ? String(msg.from.id) : null;
  const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
  if (!text || !fromId || !chatId) return;

  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1];
    if (!token) {
      await sendTelegramMessage(
        chatId,
        'Pour lier votre compte, ouvrez la plateforme, cliquez « Lier Telegram » puis envoyez /start <token>.'
      );
      return;
    }
    const adminId = await consumeTelegramLink(token);
    if (adminId) {
      await bindTelegramToAdmin(adminId, chatId);
      await sendTelegramMessage(
        chatId,
        '✅ Compte lié. Vous pouvez me parler ici comme sur la plateforme.'
      );
    } else {
      await sendTelegramMessage(chatId, '❌ Lien invalide ou expiré.');
    }
    return;
  }

  const admin = await getAdminByTelegramUserId(fromId);
  if (!admin) {
    await sendTelegramMessage(
      chatId,
      'Compte non lié. Utilisez « Lier Telegram » sur la plateforme puis /start <token>.'
    );
    return;
  }

  try {
    const conv = await getOrCreateAdminAssistant(admin.id);
    await runAgentTurn(conv.id, text, {
      type: 'admin',
      adminId: admin.id,
      adminName: admin.name
    });
  } catch (e) {
    console.error('[telegram] turn failed:', e);
    await sendTelegramMessage(chatId, '⚠️ Une erreur est survenue.');
  }
}
