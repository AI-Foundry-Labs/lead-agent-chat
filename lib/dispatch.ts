import { eq } from 'drizzle-orm';
import { db, admins, getLeadById, getListing } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { sendTelegramMessage } from '@/lib/telegram';
import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { getLeadTopicsByLead } from '@/lib/db/lead-telegram-topics';
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

/**
 * Mirror a lead conversation turn into Topic 1 (💬 Conversation) of the
 * agency's Telegram supergroup.
 *
 * Role prefixes: lead user → "Lead", agent reply → "Agent".
 * Sends are tagged kind:'mirror' — they may be dropped under queue pressure.
 * Never throws: errors are logged but not re-raised so a mirror failure cannot
 * break the main agent turn.
 */
export async function mirrorLeadTurnToTopic(
  conversation: Conversation,
  role: 'lead' | 'agent' | 'admin',
  content: string
): Promise<void> {
  if (!content.trim()) return;
  if (conversation.type !== 'lead') return;
  if (!conversation.lead_id) return;

  try {
    const topics = await getLeadTopicsByLead(
      conversation.agency_id,
      conversation.lead_id
    );
    if (!topics) return; // lead has no forum topics yet — no-op
    if (!topics.group_chat_id) return;
    if (!topics.conversation_topic_id) return;

    // Icons disambiguate who said what in the conversation mirror.
    const prefixMap: Record<'lead' | 'agent' | 'admin', string> = {
      lead: '🧑 Lead',
      agent: '🤖 Agent',
      admin: '🧑‍💼 Conseiller'
    };
    const prefix = prefixMap[role];
    const text = `${prefix}: ${content}`;

    // Admin replies are 'critical' (never dropped); lead/agent turns are 'mirror' (droppable).
    const kind = role === 'admin' ? 'critical' : 'mirror';
    void enqueueGroupSend(topics.group_chat_id, text, {
      threadId: topics.conversation_topic_id,
      kind
    });
  } catch (e) {
    console.error('[dispatch] mirrorLeadTurnToTopic failed — non-fatal:', e);
  }
}
