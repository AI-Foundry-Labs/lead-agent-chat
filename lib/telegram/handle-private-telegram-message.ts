/**
 * Private-chat Telegram message handlers.
 * Extracted from handle-lead-telegram-update.ts for file size compliance.
 *
 * Handles: admin /start linking, lead /start linking, admin messages,
 * lead messages, and the unlinked fallback reply.
 */

import {
  consumeTelegramLink,
  consumeLeadTelegramLink
} from '@/lib/auth';
import {
  bindTelegramToAdmin,
  getAdminByTelegramUserId,
  getOrCreateMainAssistant,
  getConversation,
  getOrCreateLeadTelegramConversation,
  getMostRecentLeadTelegramConversation,
  bindTelegramToLead,
  getLeadByTelegramUserId,
  updateConversation,
  db,
  admins
} from '@/lib/db';
import { eq } from 'drizzle-orm';
import { ensureLeadForConversation } from '@/lib/telegram/ensure-lead-for-conversation';
import { sendTelegramMessage } from '@/lib/telegram';
import { runAgentTurn } from '@/lib/agent/run';

export async function handleAdminStart(
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

export async function handleLeadStart(
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

  const lead = await ensureLeadForConversation(source, source.agency_id);
  await bindTelegramToLead(lead.id, fromId);

  const listingId = payload.listing_id ?? source.listing_id;
  await getOrCreateLeadTelegramConversation({
    agencyId: source.agency_id,
    leadId: lead.id,
    listingId
  });

  await sendTelegramMessage(
    chatId,
    "✅ Telegram lié. Ceci est un fil séparé du site — vos préférences et qualifications sont partagées, mais l'historique de chat ici repart à zéro.\n\n✅ Telegram linked. This is a separate thread from the website — your preferences are shared, but chat history here starts fresh.\n\nPosez votre question sur le bien / Ask your question about the property."
  );
  return true;
}

export async function handleAdminMessage(
  chatId: string,
  fromId: string,
  text: string
): Promise<boolean> {
  const admin = await getAdminByTelegramUserId(fromId);
  if (!admin) return false;

  const [adminRow] = await db
    .select({ agency_id: admins.agency_id })
    .from(admins)
    .where(eq(admins.id, admin.id))
    .limit(1);
  if (!adminRow) return false;

  const conv = await getOrCreateMainAssistant(admin.id, adminRow.agency_id);
  await runAgentTurn(conv.id, text, {
    type: 'main_assistant',
    adminId: admin.id,
    adminName: admin.name
  });
  return true;
}

export async function handleLeadMessage(
  fromId: string,
  text: string
): Promise<boolean> {
  const lead = await getLeadByTelegramUserId(fromId);
  if (!lead) return false;

  const conv =
    (await getMostRecentLeadTelegramConversation(lead.id)) ??
    (await getOrCreateLeadTelegramConversation({
      agencyId: lead.agency_id,
      leadId: lead.id,
      listingId: lead.listing_id
    }));

  if (!conv.lead_id) {
    await updateConversation(conv.id, { lead_id: lead.id });
  }

  await runAgentTurn(conv.id, text, { type: 'lead' });
  return true;
}

/** Send the "not linked yet" fallback reply for unknown private-chat senders. */
export async function sendUnlinkedReply(chatId: string): Promise<void> {
  await sendTelegramMessage(
    chatId,
    "Compte non lié. Ouvrez le lien « Continuer sur Telegram » depuis le site, ou demandez le code à l'assistant.\n\nNot linked yet — use the \"Continue on Telegram\" link from the website chat."
  );
}

/** Send the "no token" greeting based on whether sender is a known admin/lead. */
export async function sendStartNoTokenReply(
  chatId: string,
  fromId: string
): Promise<'admin' | 'lead' | 'unlinked'> {
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
