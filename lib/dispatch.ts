import { eq } from 'drizzle-orm';
import { db, admins, getLeadById, getListing } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { sendTelegramMessage } from '@/lib/telegram';
import type { Conversation } from '@/lib/types';

// Send an assistant/admin reply out over a conversation's non-web channels.
// Web clients are updated separately via the SSE broadcast in the agent loop, so
// here we only handle outbound email + Telegram.
export async function dispatchReply(
  conversation: Conversation,
  content: string
): Promise<void> {
  if (!content.trim()) return;

  if (conversation.type === 'lead' && conversation.primary_channel === 'email') {
    const lead = conversation.lead_id
      ? await getLeadById(conversation.lead_id)
      : null;
    if (lead?.email) {
      const listing = await getListing(conversation.listing_id);
      await sendEmail({
        to: lead.email,
        subject: listing ? `Re: ${listing.title}` : 'Votre demande',
        text: content
      });
    }
  }

  if (conversation.type === 'lead' && conversation.primary_channel === 'telegram') {
    const lead = conversation.lead_id
      ? await getLeadById(conversation.lead_id)
      : null;
    const chatId = lead?.telegram_user_id;
    if (chatId) await sendTelegramMessage(chatId, content);
  }

  // Admin-facing agents push replies to the admin's Telegram chat.
  if (conversation.type === 'main_assistant' && conversation.admin_id) {
    const rows = await db
      .select({ telegram_user_id: admins.telegram_user_id })
      .from(admins)
      .where(eq(admins.id, conversation.admin_id))
      .limit(1);
    const chatId = rows[0]?.telegram_user_id;
    if (chatId) await sendTelegramMessage(chatId, content);
  }
}

// Forward a web-originated user message to the admin's Telegram so the full
// conversation is visible on both channels.
export async function dispatchUserMessage(
  conversation: Conversation,
  senderName: string,
  content: string
): Promise<void> {
  if (!content.trim()) return;
  if (conversation.type === 'main_assistant' && conversation.admin_id) {
    const rows = await db
      .select({ telegram_user_id: admins.telegram_user_id })
      .from(admins)
      .where(eq(admins.id, conversation.admin_id))
      .limit(1);
    const chatId = rows[0]?.telegram_user_id;
    if (chatId) await sendTelegramMessage(chatId, `user message: ${senderName}\n${content}`);
  }
}

