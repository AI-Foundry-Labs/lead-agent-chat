/**
 * Agency-scoped Telegram notification for a lead handoff/alert.
 *
 * Posts into the lead's 🤖 Assistant topic — the place the admin acts on the
 * lead (instruct the agent to reply, e.g. "reply: we can reduce 5%"). This puts
 * the call-to-action where the admin can actually respond, instead of the
 * un-actionable General feed.
 *
 * Fallback order: 🤖 Assistant topic → 💬 Conversation topic → General feed
 * (only when the lead has no per-lead topics at all, e.g. older leads).
 *
 * kind:'critical' so it is never dropped under queue pressure. Never throws.
 */

import { getAgencyById } from '@/lib/db/agencies';
import { getLeadTopicsByLead } from '@/lib/db/lead-telegram-topics';
import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';

export async function notifyAgency(
  agencyId: string,
  leadId: string,
  summary: string
): Promise<void> {
  try {
    const agency = await getAgencyById(agencyId);
    if (!agency?.telegram_group_chat_id) {
      console.log('[notify-agency] no telegram group for agency', agencyId, '—', summary);
      return;
    }

    const groupChatId = agency.telegram_group_chat_id;
    const topics = await getLeadTopicsByLead(agencyId, leadId);

    // Prefer the 🤖 Assistant topic (admin instructs the agent there).
    const threadId =
      topics?.assistant_topic_id ?? topics?.conversation_topic_id ?? undefined;

    // Hint where to act when we have a lead topic.
    const text = threadId
      ? `${summary}\n\n💬 Répondez ici : « reply: … » pour que l'agent réponde au client.\n` +
        `💬 Reply here: "reply: …" and the agent will message the customer.`
      : summary;

    void enqueueGroupSend(groupChatId, text, {
      ...(threadId ? { threadId } : {}),
      kind: 'critical'
    });
  } catch (e) {
    console.error('[notify-agency] failed — non-fatal:', e);
  }
}
