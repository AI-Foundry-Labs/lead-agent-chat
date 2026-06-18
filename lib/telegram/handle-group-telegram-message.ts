/**
 * Group-specific message handlers, extracted so handle-lead-telegram-update.ts
 * stays under 200 lines.
 *
 * Handlers:
 *   handleOperatorTopicMessage   — Topic 2 (🤖 Assistant): operator copilot turn.
 *   handleConversationTopicMessage — Topic 1 (💬 Conversation): read-only pointer.
 *   handleMasterTopicMessage     — 🛠 Master topic: /agent hub + subagent dispatch.
 *   handleAgentCallback          — Inline-keyboard tap (callback_query) in Master topic.
 */

import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { resolveActingAdmin } from '@/lib/telegram/resolve-agency-admin';
import { runAgentTurn } from '@/lib/agent/run';
import { getOrCreateMainAssistant, getOrCreateLeadOperator } from '@/lib/db/conversations';
import { listLeads, getLeadById } from '@/lib/db';
import type { LeadTelegramTopics } from '@/lib/db/lead-telegram-topics';
import type { Agency } from '@/lib/db/agencies';
import { parseAgentCommand, parseAgentCallback, buildAgentKeyboard, formatAgentLabel } from '@/lib/telegram/agent-command';
import { getAgentSession, setAgentSession, resolveActiveActor } from '@/lib/db/telegram-agent-sessions';
import { sendTelegramKeyboard } from '@/lib/telegram/send-keyboard';

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
    "donnez la consigne à l'assistant dans le sujet 🤖 Assistant, ou utilisez l'interface web.\n" +
    'ℹ️ This thread only shows the conversation. To reply to the customer, instruct the ' +
    'assistant in the 🤖 Assistant topic, or use the web interface.',
    { threadId: mapping.conversation_topic_id, kind: 'critical' }
  );
}

// ─── 🛠 Master topic: /agent hub + subagent dispatch ─────────────────────

/**
 * Hub for the agency's 🛠 Master topic.
 *
 * Commands:
 *   /agent          — show inline picker (Main + recent leads)
 *   /agent main     — set active agent to main_assistant
 *   /agent lead <q> — set active agent to operator for matching lead
 *   <plain text>    — dispatch to currently active subagent
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
      void enqueueGroupSend(chatId, '❌ Aucun administrateur trouvé. / No admin found.', {
        threadId, kind: 'critical'
      });
      return;
    }

    const cmd = parseAgentCommand(text);

    // /agent — show picker (Main + recent leads)
    if (cmd.kind === 'show') {
      const leads = (await listLeads(agency.id)).slice(0, 8)
        .map((l) => ({ id: l.id, label: l.name ?? l.email ?? l.id.slice(0, 8) }));
      const session = await getAgentSession(agency.id);
      const current = formatAgentLabel(session, session?.agent_kind === 'operator'
        ? (await getLeadById(session.lead_id))?.name : null);
      await sendTelegramKeyboard(
        chatId,
        `Actuel : ${current}\nChoisissez l'agent : / Choose agent:`,
        buildAgentKeyboard(leads),
        threadId
      );
      return;
    }

    // /agent main
    if (cmd.kind === 'set_main') {
      await setAgentSession(agency.id, { agent_kind: 'main', lead_id: null });
      void enqueueGroupSend(chatId, '✅ Agent : 🤖 Main', { threadId, kind: 'critical' });
      return;
    }

    // /agent lead <query>
    if (cmd.kind === 'set_lead') {
      const q = cmd.query.toLowerCase();
      const match = (await listLeads(agency.id)).find(
        (l) => (l.name ?? '').toLowerCase().includes(q) || (l.email ?? '').toLowerCase().includes(q)
      );
      if (!match) {
        void enqueueGroupSend(chatId, `❌ Lead introuvable : "${cmd.query}"`, { threadId, kind: 'critical' });
        return;
      }
      await setAgentSession(agency.id, { agent_kind: 'operator', lead_id: match.id });
      void enqueueGroupSend(chatId, `✅ Agent : ${formatAgentLabel({ agent_kind: 'operator', lead_id: match.id }, match.name)}`, { threadId, kind: 'critical' });
      return;
    }

    // Plain text → dispatch to active subagent
    const session = await getAgentSession(agency.id);
    const actor = resolveActiveActor(session);
    if (!actor) {
      void enqueueGroupSend(chatId, 'ℹ️ Aucun agent sélectionné. Tapez /agent pour choisir.', { threadId, kind: 'critical' });
      return;
    }

    if (actor.type === 'operator') {
      const conv = await getOrCreateLeadOperator(actor.leadId, agency.id);
      const lead = await getLeadById(actor.leadId);
      const result = await runAgentTurn(conv.id, text, {
        type: 'operator', leadId: actor.leadId, adminId: admin.id, adminName: admin.name
      });
      if (result.reply.trim()) {
        void enqueueGroupSend(chatId,
          `${formatAgentLabel(session, lead?.name)} — ${result.reply}`,
          { threadId, kind: 'critical' });
      }
      return;
    }

    // main_assistant
    const conv = await getOrCreateMainAssistant(admin.id, agency.id);
    const result = await runAgentTurn(conv.id, text, {
      type: 'main_assistant', adminId: admin.id, adminName: admin.name
    });
    if (result.reply.trim()) {
      void enqueueGroupSend(chatId, `🤖 Main — ${result.reply}`, { threadId, kind: 'critical' });
    }
  } catch (err) {
    console.error('[master-topic] handleMasterTopicMessage error:', err);
    void enqueueGroupSend(chatId, '❌ Erreur interne. / Internal error.', { threadId, kind: 'critical' });
  }
}

// ─── Inline-keyboard callback handler ────────────────────────────────────

/** Handle an inline-keyboard tap (callback_query.data) in the Master topic. */
export async function handleAgentCallback(
  chatId: string,
  agency: Agency,
  data: string,
  threadId: number
): Promise<void> {
  const cb = parseAgentCallback(data);
  if (!cb) return;
  if (cb.kind === 'main') {
    await setAgentSession(agency.id, { agent_kind: 'main', lead_id: null });
    void enqueueGroupSend(chatId, '✅ Agent : 🤖 Main', { threadId, kind: 'critical' });
    return;
  }
  const lead = await getLeadById(cb.leadId);
  if (!lead || lead.agency_id !== agency.id) {
    void enqueueGroupSend(chatId, '❌ Lead invalide.', { threadId, kind: 'critical' });
    return;
  }
  await setAgentSession(agency.id, { agent_kind: 'operator', lead_id: cb.leadId });
  void enqueueGroupSend(chatId, `✅ Agent : ${formatAgentLabel({ agent_kind: 'operator', lead_id: cb.leadId }, lead.name)}`, { threadId, kind: 'critical' });
}
