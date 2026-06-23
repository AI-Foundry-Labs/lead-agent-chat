/**
 * Agency-scoped Telegram notification for a lead handoff/alert.
 *
 * Single-topic UX: posts proactively into the 🛠 Master topic — the one place
 * the admin acts on leads via the master agent + slash commands (/leads,
 * /lead_history, /agent). Admins see the alert immediately, no command needed.
 *
 * Falls back to the General feed only when the Master topic isn't created yet.
 * kind:'critical' so it is never dropped under queue pressure. Never throws.
 */

import { getAgencyById } from '@/lib/db/agencies';
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
    const threadId = agency.telegram_master_topic_id ?? undefined;

    // Point the admin at the master agent for follow-up actions.
    const text =
      `${summary}\n\n` +
      `💬 /lead_history <nom> pour l'historique · /agent pour répondre au client.\n` +
      `💬 /lead_history <name> for history · /agent to reply to the customer.`;

    void enqueueGroupSend(groupChatId, text, {
      ...(threadId ? { threadId } : {}),
      kind: 'critical'
    });
  } catch (e) {
    console.error('[notify-agency] failed — non-fatal:', e);
  }
}

/**
 * Push a raw text notification straight into the agency's 🛠 Master topic.
 *
 * Used for events that have no lead row yet (e.g. an anonymous visitor handoff)
 * so the master agent surface still gets the alert proactively. No-op when the
 * agency has no linked group. Never throws.
 */
export async function notifyAgencyGroup(
  agencyId: string,
  text: string
): Promise<void> {
  try {
    const agency = await getAgencyById(agencyId);
    if (!agency?.telegram_group_chat_id) {
      console.log('[notify-agency] no telegram group for agency', agencyId, '—', text);
      return;
    }
    void enqueueGroupSend(agency.telegram_group_chat_id, text, {
      ...(agency.telegram_master_topic_id
        ? { threadId: agency.telegram_master_topic_id }
        : {}),
      kind: 'critical'
    });
  } catch (e) {
    console.error('[notify-agency] group send failed — non-fatal:', e);
  }
}
