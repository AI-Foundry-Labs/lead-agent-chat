// Notification = operator-composed report, sent to the Master topic and
// persisted to BOTH the operator↔admin and main-assistant↔admin histories.

// Type-only imports are erased at compile time — they do NOT load lib/llm at
// module load, keeping buildNotificationTargets importable in unit-test env.
import type { StaffEvent } from '@/lib/agent/staff-report';
import type { Language } from '@/lib/types';

export type NotificationTarget = { conversation_id: string; role: 'assistant'; content: string };

/** Pure: the conversation rows that must receive this notification. */
export function buildNotificationTargets(
  operatorConvId: string,
  mainConvId: string,
  content: string
): NotificationTarget[] {
  const ids = operatorConvId === mainConvId ? [operatorConvId] : [operatorConvId, mainConvId];
  return ids.map((conversation_id) => ({ conversation_id, role: 'assistant', content }));
}

/**
 * Compose a staff notification as the lead's operator persona, dual-write it
 * to both the operator↔admin and main-assistant↔admin DB histories, then
 * fire it to the agency's Master Telegram topic (non-fatal on failure).
 *
 * Deps are loaded lazily so that importing this module in unit-test env
 * (no LLM keys, no DB URL) does NOT crash on module load.
 */
export async function pushAgentNotification(args: {
  agencyId: string;
  leadId: string;
  event: StaffEvent;
  lang?: Language;
}): Promise<void> {
  const { agencyId, leadId, event } = args;
  const lang = args.lang ?? 'fr';

  // Lazy-load all heavy deps to avoid crashing at module-load time in tests.
  const [
    { generateStaffReport },
    { getOrCreateLeadOperator, getOrCreateMainAssistant, getAgencyById, getLeadById, addMessage, listAdminsByAgency },
    { enqueueGroupSend },
    { formatAgentLabel },
    { broadcastConversationUpdate }
  ] = await Promise.all([
    import('@/lib/agent/staff-report'),
    import('@/lib/db'),
    import('@/lib/telegram/group-send-queue'),
    import('@/lib/telegram/agent-command'),
    import('@/lib/events')
  ]);

  // 1. Compose the notice as the operator of this lead.
  const body = await generateStaffReport(event, lang);
  const lead = await getLeadById(leadId);
  // AgentSession operator variant: { agent_kind: 'operator', lead_id: string }
  const label = formatAgentLabel({ agent_kind: 'operator', lead_id: leadId }, lead?.name);
  const content = `${label} — ${body}`;

  // 2. Resolve the two conversations (single admin per agency).
  const admins = await listAdminsByAgency(agencyId);
  const admin = admins[0];
  const operatorConv = await getOrCreateLeadOperator(leadId, agencyId);
  const mainConv = admin ? await getOrCreateMainAssistant(admin.id, agencyId) : null;

  // 3. Dual-write to DB histories (independent of Telegram delivery).
  const targets = buildNotificationTargets(
    operatorConv.id,
    mainConv?.id ?? operatorConv.id,
    content
  );
  for (const t of targets) {
    await addMessage({ conversation_id: t.conversation_id, role: t.role, content: t.content });
    broadcastConversationUpdate(t.conversation_id);
  }

  // 4. Send to the Master topic chat channel (non-fatal on failure).
  try {
    const agency = await getAgencyById(agencyId);
    // Single-topic UX: send to the group whenever it's linked. Use the Master
    // topic when set, otherwise fall back to General (threadId undefined).
    if (agency?.telegram_group_chat_id) {
      void enqueueGroupSend(agency.telegram_group_chat_id, content, {
        threadId: agency.telegram_master_topic_id ?? undefined,
        kind: 'critical'
      });
    }
  } catch (e) {
    console.error('[push-agent-notification] telegram send failed (non-fatal):', e);
  }
}
