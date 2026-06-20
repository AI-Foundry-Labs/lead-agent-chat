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
} from '@/lib/telegram/agent-command';
import { getAgentSession, setAgentSession } from '@/lib/db/telegram-agent-sessions';
import { listLeads, getLeadById, getConversationByLeadId, getVisibleMessages } from '@/lib/db';
import type { Agency } from '@/lib/db/agencies';

// Telegram hard-caps messages at 4096 chars.
function clip(s: string, max = 3800): string {
  return s.length > max ? s.slice(0, max) + '\n…(tronqué)' : s;
}

function leadButtons(leads: Awaited<ReturnType<typeof listLeads>>) {
  return leads.map((l) => ({ id: l.id, label: l.name ?? l.email ?? l.id.slice(0, 8) }));
}

async function answerCq(callbackQueryId: string) {
  const b = getBot();
  if (!b) return;
  try { await b.api.answerCallbackQuery(callbackQueryId); } catch { /* non-fatal */ }
}

// ─── Individual callback handlers ────────────────────────────────────────────

async function handleMain(chatId: string, agencyId: string, threadId: number | undefined) {
  await setAgentSession(agencyId, { agent_kind: 'main', lead_id: null });
  void enqueueGroupSend(chatId, '✅ Agent : 🤖 Main', { threadId, kind: 'critical' });
}

async function handleLead(chatId: string, agency: Agency, leadId: string, threadId: number | undefined) {
  const lead = await getLeadById(leadId);
  if (!lead || lead.agency_id !== agency.id) {
    void enqueueGroupSend(chatId, '❌ Lead invalide.', { threadId, kind: 'critical' });
    return;
  }
  await setAgentSession(agency.id, { agent_kind: 'operator', lead_id: leadId });
  void enqueueGroupSend(
    chatId,
    `✅ Agent : ${formatAgentLabel({ agent_kind: 'operator', lead_id: leadId }, lead.name)}`,
    { threadId, kind: 'critical' }
  );
}

async function handleDetail(chatId: string, agency: Agency, leadId: string, threadId: number | undefined) {
  const lead = await getLeadById(leadId);
  if (!lead || lead.agency_id !== agency.id) {
    void enqueueGroupSend(chatId, '❌ Lead invalide.', { threadId, kind: 'critical' });
    return;
  }
  const lines = [
    `👤 ${lead.name ?? '—'} <${lead.email ?? '—'}>`,
    `Statut: ${lead.status}${lead.potential_status ? ` · ${lead.potential_status}` : ''}`,
    lead.score_reason ? `Raison: ${lead.score_reason}` : null,
    Object.keys(lead.qual_values ?? {}).length ? `Qualif: ${JSON.stringify(lead.qual_values)}` : null,
    lead.long_term_memory ? `Mémoire: ${lead.long_term_memory.slice(0, 400)}` : null,
  ].filter(Boolean);
  void enqueueGroupSend(chatId, clip(lines.join('\n')), { threadId, kind: 'critical' });
}

async function handleHistory(chatId: string, agency: Agency, leadId: string, threadId: number | undefined) {
  const lead = await getLeadById(leadId);
  if (!lead || lead.agency_id !== agency.id) {
    void enqueueGroupSend(chatId, '❌ Lead invalide.', { threadId, kind: 'critical' });
    return;
  }
  const conv = await getConversationByLeadId(lead.id);
  if (!conv) {
    void enqueueGroupSend(chatId, '(aucune conversation pour ce lead)', { threadId, kind: 'critical' });
    return;
  }
  const msgs = (await getVisibleMessages(conv.id)).slice(-30);
  const icon: Record<string, string> = { user: '🧑', assistant: '🤖', admin: '🧑‍💼' };
  const body = msgs.length
    ? msgs.map((m) => `${icon[m.role] ?? m.role}: ${m.content}`).join('\n')
    : '(aucun message)';
  void enqueueGroupSend(
    chatId,
    clip(`💬 ${lead.name ?? lead.email ?? 'Lead'} — ${msgs.length} dernier(s) message(s):\n${body}`),
    { threadId, kind: 'critical' }
  );
}

async function handleAgentPage(chatId: string, agency: Agency, page: number, threadId: number | undefined) {
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
  chatId: string, agency: Agency, status: string, page: number, threadId: number | undefined
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

async function handleHistPage(chatId: string, agency: Agency, page: number, threadId: number | undefined) {
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
  callbackQueryId?: string
): Promise<void> {
  if (callbackQueryId) await answerCq(callbackQueryId);

  const admin = await resolveActingAdmin(fromId, agency.id);
  if (!admin) {
    void enqueueGroupSend(chatId, '❌ Aucun administrateur trouvé. / No admin found.', {
      threadId, kind: 'critical',
    });
    return;
  }

  const cb = parseAgentCallback(data);
  if (!cb) return;

  switch (cb.kind) {
    case 'main':      return handleMain(chatId, agency.id, threadId);
    case 'lead':      return handleLead(chatId, agency, cb.leadId, threadId);
    case 'detail':    return handleDetail(chatId, agency, cb.leadId, threadId);
    case 'history':   return handleHistory(chatId, agency, cb.leadId, threadId);
    case 'agent_pg':  return handleAgentPage(chatId, agency, cb.page, threadId);
    case 'leads_pg':  return handleLeadsPage(chatId, agency, cb.status, cb.page, threadId);
    case 'hist_pg':   return handleHistPage(chatId, agency, cb.page, threadId);
  }
}
