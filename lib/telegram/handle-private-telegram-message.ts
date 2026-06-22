/**
 * Private-chat Telegram message handlers.
 * Extracted from handle-lead-telegram-update.ts for file size compliance.
 *
 * Handles: admin /start linking, lead /start linking, admin messages,
 * lead messages, and the unlinked fallback reply.
 */

import {
  consumeTelegramLink,
  consumeLeadTelegramLink
} from '@/lib/auth';
import {
  bindTelegramToAdmin,
  getAdminByTelegramUserId,
  getOrCreateMainAssistant,
  getOrCreateLeadOperator,
  getConversation,
  getOrCreateLeadTelegramConversation,
  getMostRecentLeadTelegramConversation,
  bindTelegramToLead,
  getLeadByTelegramUserId,
  updateConversation,
  getAgencyById,
  listLeads,
  getLeadById,
} from '@/lib/db';
import { ensureLeadForConversation } from '@/lib/telegram/ensure-lead-for-conversation';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendTelegramKeyboard } from '@/lib/telegram/send-keyboard';
import { runAgentTurn } from '@/lib/agent/run';
import { tryHandleMasterCommand } from '@/lib/telegram/master-commands';
import { parseAgentCommand, buildAgentKeyboard, formatAgentLabel } from '@/lib/telegram/agent-command';
import { getAgentSession, setAgentSession, resolveActiveActor } from '@/lib/db/telegram-agent-sessions';

export async function handleAdminStart(
  chatId: string,
  token: string
): Promise<boolean> {
  const adminId = await consumeTelegramLink(token);
  if (!adminId) return false;
  await bindTelegramToAdmin(adminId, chatId);
  await sendTelegramMessage(
    chatId,
    '✅ Compte lié. Vous pouvez me parler ici comme sur la plateforme.'
  );
  return true;
}

export async function handleLeadStart(
  chatId: string,
  fromId: string,
  token: string
): Promise<boolean> {
  const payload = await consumeLeadTelegramLink(token);
  if (!payload) return false;

  const source = await getConversation(payload.conversation_id);
  if (!source || source.type !== 'lead') {
    await sendTelegramMessage(chatId, '❌ Lien invalide ou expiré.');
    return true;
  }

  const lead = await ensureLeadForConversation(source, source.agency_id);
  await bindTelegramToLead(lead.id, fromId);

  const listingId = payload.listing_id ?? source.listing_id;
  await getOrCreateLeadTelegramConversation({
    agencyId: source.agency_id,
    leadId: lead.id,
    listingId
  });

  await sendTelegramMessage(
    chatId,
    "✅ Telegram lié. Ceci est un fil séparé du site — vos préférences et qualifications sont partagées, mais l'historique de chat ici repart à zéro.\n\nPosez votre question sur le bien."
  );
  return true;
}

export async function handleAdminMessage(
  chatId: string,
  fromId: string,
  text: string
): Promise<boolean> {
  const admin = await getAdminByTelegramUserId(fromId);
  if (!admin) return false;

  const agency = await getAgencyById(admin.agency_id);
  if (!agency) return false;

  const send = (msg: string) => void sendTelegramMessage(chatId, msg);

  // Slash commands (/help, /leads, /lead, /lead_history, /pool)
  if (await tryHandleMasterCommand(chatId, agency, undefined, text, send)) return true;

  // /agent command — show picker or set active agent
  const normalizedText = text.replace(/^(\/\w+)@\S+/, '$1');
  const cmd = parseAgentCommand(normalizedText);

  if (cmd.kind === 'show') {
    const leads = (await listLeads(agency.id)).map((l) => ({
      id: l.id, label: l.name ?? l.email ?? 'Anonymous',
    }));
    const session = await getAgentSession(agency.id);
    const activeLeadId = session?.agent_kind === 'operator' ? session.lead_id : null;
    const current = formatAgentLabel(session, activeLeadId
      ? (await getLeadById(activeLeadId))?.name : null);
    await sendTelegramKeyboard(
      chatId,
      `Actuel : ${current}\nChoisissez l'agent :`,
      buildAgentKeyboard(leads, { activeLeadId })
    );
    return true;
  }

  if (cmd.kind === 'set_main') {
    await setAgentSession(agency.id, { agent_kind: 'main', lead_id: null });
    send('✅ Agent : 🤖 Main');
    return true;
  }

  if (cmd.kind === 'set_lead') {
    const q = cmd.query.toLowerCase();
    const match = (await listLeads(agency.id)).find(
      (l) => (l.name ?? '').toLowerCase().includes(q) || (l.email ?? '').toLowerCase().includes(q)
    );
    if (!match) { send(`❌ Lead introuvable : "${cmd.query}"`); return true; }
    await setAgentSession(agency.id, { agent_kind: 'operator', lead_id: match.id });
    send(`✅ Agent : ${formatAgentLabel({ agent_kind: 'operator', lead_id: match.id }, match.name)}`);
    return true;
  }

  // Plain text → dispatch to active agent session
  const session = await getAgentSession(agency.id);
  const actor = resolveActiveActor(session);

  if (actor?.type === 'operator') {
    const conv = await getOrCreateLeadOperator(actor.leadId, agency.id);
    const lead = await getLeadById(actor.leadId);
    const result = await runAgentTurn(conv.id, text, {
      type: 'operator', leadId: actor.leadId, adminId: admin.id, adminName: admin.name ?? null,
    });
    if (result.reply.trim()) {
      send(`${formatAgentLabel(session, lead?.name)} — ${result.reply}`);
    }
    return true;
  }

  // Default: main_assistant.
  // dispatchReply (inside runAgentTurn) already sends the reply to admin's Telegram DM
  // for main_assistant conversations — do NOT call send() here or the reply is duplicated.
  const conv = await getOrCreateMainAssistant(admin.id, agency.id);
  await runAgentTurn(conv.id, text, {
    type: 'main_assistant', adminId: admin.id, adminName: admin.name ?? null,
  });
  return true;
}

export async function handleLeadMessage(
  fromId: string,
  text: string
): Promise<boolean> {
  const lead = await getLeadByTelegramUserId(fromId);
  if (!lead) return false;

  const conv =
    (await getMostRecentLeadTelegramConversation(lead.id)) ??
    (await getOrCreateLeadTelegramConversation({
      agencyId: lead.agency_id,
      leadId: lead.id,
      listingId: lead.listing_id
    }));

  if (!conv.lead_id) {
    await updateConversation(conv.id, { lead_id: lead.id });
  }

  await runAgentTurn(conv.id, text, { type: 'lead' });
  return true;
}

/** Send the "not linked yet" fallback reply for unknown private-chat senders. */
export async function sendUnlinkedReply(chatId: string): Promise<void> {
  await sendTelegramMessage(
    chatId,
    "Compte non lié. Ouvrez le lien « Continuer sur Telegram » depuis le site, ou demandez le code à l'assistant.\n\nNot linked yet — use the \"Continue on Telegram\" link from the website chat."
  );
}

/** Send the "no token" greeting based on whether sender is a known admin/lead. */
export async function sendStartNoTokenReply(
  chatId: string,
  fromId: string
): Promise<'admin' | 'lead' | 'unlinked'> {
  const isAdmin = await getAdminByTelegramUserId(fromId);
  const isLead = await getLeadByTelegramUserId(fromId);
  if (isAdmin) {
    await sendTelegramMessage(chatId, 'Bonjour ! Envoyez votre message admin.');
    return 'admin';
  }
  if (isLead) {
    await sendTelegramMessage(
      chatId,
      'Bonjour ! Continuez à me parler ici, ou ouvrez un nouveau lien depuis le site pour un autre bien.'
    );
    return 'lead';
  }
  await sendTelegramMessage(
    chatId,
    'Pour lier votre compte, ouvrez le lien Telegram depuis le chat sur le site, ou envoyez /start <code> depuis ce lien.\n\nTo link, open the Telegram link from the website chat, or send /start <code> from that link.'
  );
  return 'unlinked';
}
