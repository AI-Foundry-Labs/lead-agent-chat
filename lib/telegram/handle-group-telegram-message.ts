/**
 * Group-specific message handlers, extracted so handle-lead-telegram-update.ts
 * stays under 200 lines.
 *
 * Handlers:
 *   handleOperatorTopicMessage   — Topic 2 (🤖 Assistant): operator copilot turn.
 *   handleConversationTopicMessage — Topic 1 (💬 Conversation): read-only pointer.
 *   handleMasterTopicMessage     — 🛠 Master topic: routes to main_assistant agent.
 */

import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { resolveActingAdmin } from '@/lib/telegram/resolve-agency-admin';
import { runAgentTurn } from '@/lib/agent/run';
import { getOrCreateMainAssistant } from '@/lib/db/conversations';
import type { LeadTelegramTopics } from '@/lib/db/lead-telegram-topics';
import type { Agency } from '@/lib/db/agencies';

// ─── Topic 2 (🤖 Assistant): operator copilot turn ────────────────────────

/**
 * Operator copilot turn in Topic 2.
 * Unmapped sender → bilingual rejection (red-team C2 — no silent fallback).
 * Reply posted into Topic 2 ONLY via kind:'critical' queue entry.
 */
export async function handleOperatorTopicMessage(
  chatId: string,
  mapping: LeadTelegramTopics,
  fromId: string,
  text: string
): Promise<void> {
  if (!mapping.operator_conversation_id) {
    console.warn('[group] Topic 2: no operator_conversation_id for lead', mapping.lead_id);
    return;
  }
  // Group is agency-private → any member is trusted; attribute to the sender's
  // linked admin or fall back to the agency's primary admin.
  const admin = await resolveActingAdmin(fromId, mapping.agency_id);
  if (!admin) {
    void enqueueGroupSend(
      chatId,
      '❌ Aucun administrateur trouvé pour cette agence.\n' +
      '❌ No admin found for this agency.',
      { threadId: mapping.assistant_topic_id, kind: 'critical' }
    );
    return;
  }
  const result = await runAgentTurn(
    mapping.operator_conversation_id,
    text,
    { type: 'operator', leadId: mapping.lead_id, adminId: admin.id, adminName: admin.name }
  );
  if (result.reply.trim()) {
    // Post into Topic 2 only — dispatchReply skips 'operator' type so the
    // customer channel is never touched.
    void enqueueGroupSend(chatId, result.reply, {
      threadId: mapping.assistant_topic_id,
      kind: 'critical'
    });
  }
}

// ─── Topic 1 (💬 Conversation): read-only mirror ──────────────────────────

/**
 * Topic 1 is READ-ONLY: shows the lead↔agent conversation.
 * Admins typing here get a pointer back to 🤖 Assistant topic.
 */
export async function handleConversationTopicMessage(
  chatId: string,
  mapping: LeadTelegramTopics
): Promise<void> {
  void enqueueGroupSend(
    chatId,
    'ℹ️ Ce fil affiche seulement la conversation. Pour répondre au client, ' +
    "donnez la consigne à l’assistant dans le sujet 🤖 Assistant, ou utilisez l’interface web.\n" +
    'ℹ️ This thread only shows the conversation. To reply to the customer, instruct the ' +
    'assistant in the 🤖 Assistant topic, or use the web interface.',
    { threadId: mapping.conversation_topic_id, kind: 'critical' }
  );
}

// ─── 🛠 Master topic: main_assistant routing ──────────────────────────────

/**
 * Route a message from the agency's 🛠 Master topic to the main_assistant agent.
 *
 * Flow:
 *   1. Resolve acting admin (by TG sender or fallback primary admin).
 *   2. Get-or-create main_assistant conversation for that admin.
 *   3. Run one agent turn with the message text.
 *   4. Post any reply back into the Master topic.
 *
 * A failure posts a short bilingual error into the topic rather than crashing.
 */
export async function handleMasterTopicMessage(
  chatId: string,
  agency: Agency,
  fromId: string,
  text: string,
  threadId: number
): Promise<void> {
  try {
    const admin = await resolveActingAdmin(fromId, agency.id);
    if (!admin) {
      void enqueueGroupSend(
        chatId,
        '❌ Aucun administrateur trouvé pour cette agence.\n' +
        '❌ No admin found for this agency.',
        { threadId, kind: 'critical' }
      );
      return;
    }

    const conv = await getOrCreateMainAssistant(admin.id, agency.id);
    const result = await runAgentTurn(
      conv.id,
      text,
      { type: 'main_assistant', adminId: admin.id, adminName: admin.name }
    );

    if (result.reply.trim()) {
      void enqueueGroupSend(chatId, result.reply, { threadId, kind: 'critical' });
    }
  } catch (err) {
    console.error('[master-topic] handleMasterTopicMessage error:', err);
    void enqueueGroupSend(
      chatId,
      '❌ Erreur interne. Veuillez réessayer.\n❌ Internal error. Please try again.',
      { threadId, kind: 'critical' }
    );
  }
}
