/**
 * Handles all inline-keyboard callback_query events from the Master topic.
 *
 * Callback kinds (parsed by parseAgentCallback):
 *   agent:main            — switch to main_assistant
 *   agent:lead:{id}       — switch to operator for a lead
 *   agent:detail:{id}     — show lead detail card
 *   agent:history:{id}    — show last 30 messages for a lead
 *   agent:agent_pg:{N}    — paginate the /agent picker
 *   agent:leads_pg:{s}:{N}— paginate the /leads keyboard
 *   agent:hist_pg:{N}     — paginate the /lead_history picker
 */

import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { sendTelegramKeyboard } from '@/lib/telegram/send-keyboard';
import { resolveActingAdmin } from '@/lib/telegram/resolve-agency-admin';
import { getBot } from '@/lib/telegram';
import {
  parseAgentCallback,
  buildAgentKeyboard,
  buildLeadsKeyboard,
  buildLeadPickerKeyboard,
  formatAgentLabel,
  buildLeadLabel,
} from '@/lib/telegram/agent-command';
import { getAgentSession, setAgentSession } from '@/lib/db/telegram-agent-sessions';
import { listLeads, getLeadById, getConversationByLeadId, getVisibleMessages } from '@/lib/db';
import type { Agency } from '@/lib/db/agencies';

// Telegram hard-caps messages at 4096 chars.
function clip(s: string, max = 3800): string {
  return s.length > max ? s.slice(0, max) + '\n…(tronqué)' : s;
}

function leadButtons(leads: Awaited<ReturnType<typeof listLeads>>) {
  return leads.map((l) => ({ id: l.id, label: buildLeadLabel(l) }));
}

async function answerCq(callbackQueryId: string) {
  const b = getBot();
  if (!b) return;
  try { await b.api.answerCallbackQuery(callbackQueryId); } catch { /* non-fatal */ }
}

type SendFn = (msg: string) => void;

function makeGroupSend(chatId: string, threadId: number | undefined): SendFn {
  return (msg: string) => void enqueueGroupSend(chatId, msg, { threadId, kind: 'critical' });
}

// ─── Individual callback handlers ────────────────────────────────────────────

async function handleMain(chatId: string, agencyId: string, threadId: number | undefined, send?: SendFn) {
  await setAgentSession(agencyId, { agent_kind: 'main', lead_id: null });
  (send ?? makeGroupSend(chatId, threadId))('✅ Agent : 🤖 Main');
}

async function handleLead(chatId: string, agency: Agency, leadId: string, threadId: number | undefined, send?: SendFn) {
  const send_ = send ?? makeGroupSend(chatId, threadId);
  const lead = await getLeadById(leadId);
  if (!lead || lead.agency_id !== agency.id) {
    send_('❌ Lead invalide.');
    return;
  }
  await setAgentSession(agency.id, { agent_kind: 'operator', lead_id: leadId });
  send_(`✅ Agent : ${formatAgentLabel({ agent_kind: 'operator', lead_id: leadId }, buildLeadLabel(lead))}`);
}

async function handleDetail(chatId: string, agency: Agency, leadId: string, threadId: number | undefined, send?: SendFn) {
  const send_ = send ?? makeGroupSend(chatId, threadId);
  const lead = await getLeadById(leadId);
  if (!lead || lead.agency_id !== agency.id) {
    send_('❌ Lead invalide.');
    return;
  }
  const lines = [
    `👤 ${buildLeadLabel(lead)}${lead.email ? ` <${lead.email}>` : ''}`,
    `Statut: ${lead.status}${lead.potential_status ? ` · ${lead.potential_status}` : ''}`,
    lead.score_reason ? `Raison: ${lead.score_reason}` : null,
    Object.keys(lead.qual_values ?? {}).length ? `Qualif: ${JSON.stringify(lead.qual_values)}` : null,
    lead.long_term_memory ? `Mémoire: ${lead.long_term_memory.slice(0, 400)}` : null,
  ].filter(Boolean);
  send_(clip(lines.join('\n')));
}

async function handleHistory(chatId: string, agency: Agency, leadId: string, threadId: number | undefined, send?: SendFn) {
  const send_ = send ?? makeGroupSend(chatId, threadId);
  const lead = await getLeadById(leadId);
  if (!lead || lead.agency_id !== agency.id) {
    send_('❌ Lead invalide.');
    return;
  }
  const conv = await getConversationByLeadId(lead.id);
  if (!conv) {
    send_('(aucune conversation pour ce lead)');
    return;
  }
  const msgs = (await getVisibleMessages(conv.id)).slice(-30);
  const icon: Record<string, string> = { user: '🧑', assistant: '🤖', admin: '🧑‍💼' };
  const body = msgs.length
    ? msgs.map((m) => `${icon[m.role] ?? m.role}: ${m.content}`).join('\n')
    : '(aucun message)';
  send_(clip(`💬 ${buildLeadLabel(lead)} — ${msgs.length} dernier(s) message(s):\n${body}`));
}

async function handleAgentPage(chatId: string, agency: Agency, page: number, threadId: number | undefined, _send?: SendFn) {
  const leads = await listLeads(agency.id);
  const session = await getAgentSession(agency.id);
  const activeLeadId = session?.agent_kind === 'operator' ? session.lead_id : null;
  await sendTelegramKeyboard(
    chatId,
    `Choisissez l'agent (page ${page + 1}) :`,
    buildAgentKeyboard(leadButtons(leads), { activeLeadId, page }),
    threadId
  );
}

async function handleLeadsPage(
  chatId: string, agency: Agency, status: string, page: number, threadId: number | undefined, _send?: SendFn
) {
  let leads = await listLeads(agency.id);
  if (status) leads = leads.filter((l) => l.status === status || l.potential_status === status);
  await sendTelegramKeyboard(
    chatId,
    `👥 Leads${status ? ` [${status}]` : ''} (${leads.length}) — cliquez pour détail :`,
    buildLeadsKeyboard(leadButtons(leads), { page, status }),
    threadId
  );
}

async function handleHistPage(chatId: string, agency: Agency, page: number, threadId: number | undefined, _send?: SendFn) {
  const leads = await listLeads(agency.id);
  await sendTelegramKeyboard(
    chatId,
    `📜 Choisissez un lead (page ${page + 1}) :`,
    buildLeadPickerKeyboard(leadButtons(leads), page),
    threadId
  );
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function handleAgentCallback(
  chatId: string,
  agency: Agency,
  fromId: string,
  data: string,
  threadId: number | undefined,
  callbackQueryId?: string,
  sendFn?: SendFn
): Promise<void> {
  if (callbackQueryId) await answerCq(callbackQueryId);

  const admin = await resolveActingAdmin(fromId, agency.id);
  if (!admin) {
    (sendFn ?? makeGroupSend(chatId, threadId))('❌ Aucun administrateur trouvé.');
    return;
  }

  const cb = parseAgentCallback(data);
  if (!cb) return;

  switch (cb.kind) {
    case 'main':      return handleMain(chatId, agency.id, threadId, sendFn);
    case 'lead':      return handleLead(chatId, agency, cb.leadId, threadId, sendFn);
    case 'detail':    return handleDetail(chatId, agency, cb.leadId, threadId, sendFn);
    case 'history':   return handleHistory(chatId, agency, cb.leadId, threadId, sendFn);
    case 'agent_pg':  return handleAgentPage(chatId, agency, cb.page, threadId, sendFn);
    case 'leads_pg':  return handleLeadsPage(chatId, agency, cb.status, cb.page, threadId, sendFn);
    case 'hist_pg':   return handleHistPage(chatId, agency, cb.page, threadId, sendFn);
  }
}
