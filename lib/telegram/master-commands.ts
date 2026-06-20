/**
 * Deterministic slash commands for the 🛠 Master topic (single-topic UX).
 * Fast read-only shortcuts rendered straight into the Master topic — no LLM.
 * Plain text (and /agent) are handled by handleMasterTopicMessage; this module
 * only claims the read commands below and returns true when it handled one.
 *
 * Telegram command names allow only [a-z0-9_]; "/lead-chat-history" is accepted
 * by normalising '-' → '_' so both /lead_history and the hyphen form work.
 */
import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import {
  listLeads,
  getConversationByLeadId,
  getVisibleMessages,
  listAnonymousVisitorThreads
} from '@/lib/db';
import type { Agency } from '@/lib/db/agencies';
import type { Lead } from '@/lib/types';

const HELP = [
  '🛠 Commandes disponibles / Available commands:',
  '/agent — changer d’agent (main ↔ opérateur d’un lead)',
  '/leads [hot|warm|cold|active|qualified|booked|handoff] — liste des leads',
  '/lead <nom|email> — détail d’un lead',
  '/lead_history <nom|email> — historique de conversation d’un lead',
  '/pool — visiteurs anonymes (non identifiés)',
  '/help — cette aide',
  '',
  '💬 Tapez du texte normal pour discuter avec l’agent actif.'
].join('\n');

// Telegram hard caps a message at 4096 chars.
function clip(s: string, max = 3800): string {
  return s.length > max ? s.slice(0, max) + '\n…(tronqué)' : s;
}

function findLead(leads: Lead[], query: string): Lead | undefined {
  const q = query.toLowerCase();
  return leads.find(
    (l) => (l.name ?? '').toLowerCase().includes(q) || (l.email ?? '').toLowerCase().includes(q)
  );
}

function leadLine(l: Lead): string {
  const who = l.name ?? l.email ?? l.id.slice(0, 8);
  const pot = l.potential_status ? `/${l.potential_status}` : '';
  return `• ${who} — ${l.status}${pot}`;
}

/**
 * Try to handle a Master-topic slash command. Returns true if handled (caller
 * should stop), false if the text is not one of these commands (→ /agent / chat).
 */
export async function tryHandleMasterCommand(
  chatId: string,
  agency: Agency,
  threadId: number | undefined,
  text: string
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return false;
  const sp = trimmed.indexOf(' ');
  const rawCmd = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
  const cmd = rawCmd.replace(/@.*$/, '').replace(/-/g, '_'); // strip @bot, hyphen→underscore
  const arg = sp === -1 ? '' : trimmed.slice(sp + 1).trim();

  const reply = (msg: string) =>
    void enqueueGroupSend(chatId, clip(msg), { threadId, kind: 'critical' });

  switch (cmd) {
    case '/help':
      reply(HELP);
      return true;

    case '/leads': {
      let leads = await listLeads(agency.id);
      if (arg) {
        const f = arg.toLowerCase();
        leads = leads.filter((l) => l.status === f || l.potential_status === f);
      }
      const body = leads.length
        ? leads.slice(0, 30).map(leadLine).join('\n')
        : '(aucun lead)';
      reply(`👥 Leads${arg ? ` [${arg}]` : ''} (${leads.length}):\n${body}`);
      return true;
    }

    case '/lead': {
      if (!arg) return reply('Usage: /lead <nom|email>'), true;
      const lead = findLead(await listLeads(agency.id), arg);
      if (!lead) return reply(`❌ Lead introuvable : "${arg}"`), true;
      const lines = [
        `👤 ${lead.name ?? '—'} <${lead.email ?? '—'}>`,
        `Statut: ${lead.status}${lead.potential_status ? ` · ${lead.potential_status}` : ''}`,
        lead.score_reason ? `Raison: ${lead.score_reason}` : null,
        Object.keys(lead.qual_values ?? {}).length
          ? `Qualif: ${JSON.stringify(lead.qual_values)}`
          : null,
        lead.persona ? `Persona: ${lead.persona.slice(0, 400)}` : null
      ].filter(Boolean);
      reply(lines.join('\n'));
      return true;
    }

    case '/lead_history': {
      if (!arg) return reply('Usage: /lead_history <nom|email>'), true;
      const lead = findLead(await listLeads(agency.id), arg);
      if (!lead) return reply(`❌ Lead introuvable : "${arg}"`), true;
      const conv = await getConversationByLeadId(lead.id);
      if (!conv) return reply('(aucune conversation pour ce lead)'), true;
      const msgs = (await getVisibleMessages(conv.id)).slice(-30);
      const icon: Record<string, string> = { user: '🧑', assistant: '🤖', admin: '🧑‍💼' };
      const body = msgs.length
        ? msgs.map((m) => `${icon[m.role] ?? m.role}: ${m.content}`).join('\n')
        : '(aucun message)';
      reply(`💬 ${lead.name ?? lead.email ?? 'Lead'} — ${msgs.length} dernier(s) message(s):\n${body}`);
      return true;
    }

    case '/pool': {
      const threads = await listAnonymousVisitorThreads(agency.id);
      const body = threads.length
        ? threads.slice(0, 30)
            .map((t) => `• ${t.id.slice(0, 8)} — ${t.primary_channel} — ${t.listing_id ?? 'sans annonce'}`)
            .join('\n')
        : '(pool vide)';
      reply(`👻 Visiteurs anonymes (${threads.length}):\n${body}`);
      return true;
    }

    default:
      return false; // /agent, /link, /start, unknown → handled elsewhere
  }
}
