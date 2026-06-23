/**
 * Group-specific message handlers, extracted so handle-lead-telegram-update.ts
 * stays under 200 lines.
 *
 * Handlers:
 *   handleMasterTopicMessage — 🛠 Master topic: /agent hub + subagent dispatch.
 *   handleAgentCallback      — Inline-keyboard tap (callback_query) in Master topic.
 */

import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { resolveActingAdmin } from '@/lib/telegram/resolve-agency-admin';
import { runAgentTurn } from '@/lib/agent/run';
import { getOrCreateMainAssistant, getOrCreateLeadOperator } from '@/lib/db/conversations';
import { listLeads, getLeadById } from '@/lib/db';
import type { Agency } from '@/lib/db/agencies';
import { parseAgentCommand, buildAgentKeyboard, formatAgentLabel, buildLeadLabel } from '@/lib/telegram/agent-command';
import { getAgentSession, setAgentSession, resolveActiveActor } from '@/lib/db/telegram-agent-sessions';
import { sendTelegramKeyboard } from '@/lib/telegram/send-keyboard';
import { tryHandleMasterCommand } from '@/lib/telegram/master-commands';

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
  threadId: number | undefined
): Promise<void> {
  try {
    const admin = await resolveActingAdmin(fromId, agency.id);
    if (!admin) {
      void enqueueGroupSend(chatId, '❌ Aucun administrateur trouvé.', {
        threadId, kind: 'critical'
      });
      return;
    }

    // Deterministic read commands (/help, /leads, /lead, /lead_history, /pool, /reset).
    if (await tryHandleMasterCommand(chatId, agency, threadId, text, undefined, fromId)) return;

    // Strip @botname suffix Telegram appends in group chats (e.g. /agent@bot → /agent).
    const normalizedText = text.replace(/^(\/\w+)@\S+/, '$1');
    const cmd = parseAgentCommand(normalizedText);

    // /agent — show picker (Main + all leads, highlight active)
    if (cmd.kind === 'show') {
      const allLeads = await listLeads(agency.id);
      const leads = allLeads.map((l) => ({ id: l.id, label: buildLeadLabel(l) }));
      const session = await getAgentSession(agency.id);
      const activeLeadId = session?.agent_kind === 'operator' ? session.lead_id : null;
      const activeLead = activeLeadId ? await getLeadById(activeLeadId) : null;
      const current = formatAgentLabel(session, activeLead ? buildLeadLabel(activeLead) : null);
      await sendTelegramKeyboard(
        chatId,
        `Actuel : ${current}\nChoisissez l'agent :`,
        buildAgentKeyboard(leads, { activeLeadId }),
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
        (l) =>
          (l.name ?? '').toLowerCase().includes(q) ||
          (l.email ?? '').toLowerCase().includes(q) ||
          buildLeadLabel(l).toLowerCase().includes(q) ||
          (l.anon_seq != null && q.replace(/[^0-9]/g, '') === String(l.anon_seq))
      );
      if (!match) {
        void enqueueGroupSend(chatId, `❌ Lead introuvable : "${cmd.query}"`, { threadId, kind: 'critical' });
        return;
      }
      await setAgentSession(agency.id, { agent_kind: 'operator', lead_id: match.id });
      void enqueueGroupSend(chatId, `✅ Agent : ${formatAgentLabel({ agent_kind: 'operator', lead_id: match.id }, buildLeadLabel(match))}`, { threadId, kind: 'critical' });
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
          `${formatAgentLabel(session, lead ? buildLeadLabel(lead) : null)} — ${result.reply}`,
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
    void enqueueGroupSend(chatId, '❌ Erreur interne.', { threadId, kind: 'critical' });
  }
}

// handleAgentCallback is now in lib/telegram/handle-agent-callback.ts
export { handleAgentCallback } from '@/lib/telegram/handle-agent-callback';
