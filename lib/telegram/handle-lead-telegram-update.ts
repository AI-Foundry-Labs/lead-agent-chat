import {
  consumeTelegramLink,
  consumeLeadTelegramLink
} from '@/lib/auth';
import {
  bindTelegramToAdmin,
  getAdminByTelegramUserId,
  getOrCreateAdminAssistant,
  getConversation,
  getOrCreateLeadTelegramConversation,
  getMostRecentLeadTelegramConversation,
  bindTelegramToLead,
  getLeadByTelegramUserId,
  updateConversation
} from '@/lib/db';
import { ensureLeadForConversation } from '@/lib/telegram/ensure-lead-for-conversation';
import { sendTelegramMessage } from '@/lib/telegram';
import { runAgentTurn } from '@/lib/agent/run';
import type { TelegramUpdate } from '@/lib/telegram-router-types';

async function handleAdminStart(
  chatId: string,
  token: string
): Promise<boolean> {
  const adminId = await consumeTelegramLink(token);
  if (!adminId) return false;
  await bindTelegramToAdmin(adminId, chatId);
  await sendTelegramMessage(
    chatId,
    '✅ Compte lié. Vous pouvez me parler ici comme sur la plateforme.'
  );
  return true;
}

async function handleLeadStart(
  chatId: string,
  fromId: string,
  token: string
): Promise<boolean> {
  const payload = await consumeLeadTelegramLink(token);
  if (!payload) return false;

  const source = await getConversation(payload.conversation_id);
  if (!source || source.type !== 'lead') {
    await sendTelegramMessage(chatId, '❌ Lien invalide ou expiré.');
    return true;
  }

  const lead = await ensureLeadForConversation(source);
  await bindTelegramToLead(lead.id, fromId);

  const listingId = payload.listing_id ?? source.listing_id;
  await getOrCreateLeadTelegramConversation({
    leadId: lead.id,
    listingId
  });

  await sendTelegramMessage(
    chatId,
    '✅ Telegram lié. Ceci est un fil séparé du site — vos préférences et qualifications sont partagées, mais l’historique de chat ici repart à zéro.\n\n✅ Telegram linked. This is a separate thread from the website — your preferences are shared, but chat history here starts fresh.\n\nPosez votre question sur le bien / Ask your question about the property.'
  );
  return true;
}

async function handleAdminMessage(
  chatId: string,
  fromId: string,
  text: string
): Promise<boolean> {
  const admin = await getAdminByTelegramUserId(fromId);
  if (!admin) return false;

  const conv = await getOrCreateAdminAssistant(admin.id);
  await runAgentTurn(conv.id, text, {
    type: 'admin',
    adminId: admin.id,
    adminName: admin.name
  });
  return true;
}

async function handleLeadMessage(
  fromId: string,
  text: string
): Promise<boolean> {
  const lead = await getLeadByTelegramUserId(fromId);
  if (!lead) return false;

  const conv =
    (await getMostRecentLeadTelegramConversation(lead.id)) ??
    (await getOrCreateLeadTelegramConversation({
      leadId: lead.id,
      listingId: lead.listing_id
    }));

  if (!conv.lead_id) {
    await updateConversation(conv.id, { lead_id: lead.id });
  }

  await runAgentTurn(conv.id, text, { type: 'lead' });
  return true;
}

export async function handleTelegramUpdate(
  update: TelegramUpdate
): Promise<'admin' | 'lead' | 'unlinked' | 'ignored'> {
  const msg = update?.message;
  const text = msg?.text;
  const fromId = msg?.from?.id != null ? String(msg.from.id) : null;
  const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
  if (!text || !fromId || !chatId) return 'ignored';

  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1];
    if (!token) {
      const isAdmin = await getAdminByTelegramUserId(fromId);
      const isLead = await getLeadByTelegramUserId(fromId);
      if (isAdmin) {
        await sendTelegramMessage(chatId, 'Bonjour ! Envoyez votre message admin.');
        return 'admin';
      }
      if (isLead) {
        await sendTelegramMessage(
          chatId,
          'Bonjour ! Continuez à me parler ici, ou ouvrez un nouveau lien depuis le site pour un autre bien.'
        );
        return 'lead';
      }
      await sendTelegramMessage(
        chatId,
        'Pour lier votre compte, ouvrez le lien Telegram depuis le chat sur le site, ou envoyez /start <code> depuis ce lien.\n\nTo link, open the Telegram link from the website chat, or send /start <code> from that link.'
      );
      return 'unlinked';
    }

    if (await handleAdminStart(chatId, token)) return 'admin';
    if (await handleLeadStart(chatId, fromId, token)) return 'lead';

    await sendTelegramMessage(chatId, '❌ Lien invalide ou expiré.');
    return 'unlinked';
  }

  if (await handleAdminMessage(chatId, fromId, text)) return 'admin';

  if (await handleLeadMessage(fromId, text)) return 'lead';

  await sendTelegramMessage(
    chatId,
    'Compte non lié. Ouvrez le lien « Continuer sur Telegram » depuis le site, ou demandez le code à l’assistant.\n\nNot linked yet — use the “Continue on Telegram” link from the website chat.'
  );
  return 'unlinked';
}
