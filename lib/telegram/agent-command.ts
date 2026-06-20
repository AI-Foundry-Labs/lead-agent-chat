// Pure parsing/rendering helpers for the Telegram /agent hub. No I/O here.

export const AGENT_PAGE_SIZE = 8;

export type AgentCommand =
  | { kind: 'show' }
  | { kind: 'set_main' }
  | { kind: 'set_lead'; query: string }
  | { kind: 'not_command' };

export function parseAgentCommand(text: string): AgentCommand {
  const t = text.trim();
  if (t !== '/agent' && !t.startsWith('/agent ')) return { kind: 'not_command' };
  const rest = t.slice('/agent'.length).trim();
  if (rest === '') return { kind: 'show' };
  if (rest === 'main') return { kind: 'set_main' };
  if (rest === 'lead' || rest.startsWith('lead ')) {
    const query = rest.slice('lead'.length).trim();
    return query ? { kind: 'set_lead', query } : { kind: 'show' };
  }
  return { kind: 'show' };
}

export type AgentCallback =
  | { kind: 'main' }
  | { kind: 'lead'; leadId: string }
  | { kind: 'history'; leadId: string }
  | { kind: 'detail'; leadId: string }
  | { kind: 'agent_pg'; page: number }
  | { kind: 'leads_pg'; status: string; page: number }
  | { kind: 'hist_pg'; page: number }
  | null;

export function parseAgentCallback(data: string): AgentCallback {
  if (data === 'agent:main') return { kind: 'main' };

  let m = data.match(/^agent:lead:(.+)$/);
  if (m) return { kind: 'lead', leadId: m[1] };

  m = data.match(/^agent:history:(.+)$/);
  if (m) return { kind: 'history', leadId: m[1] };

  m = data.match(/^agent:detail:(.+)$/);
  if (m) return { kind: 'detail', leadId: m[1] };

  m = data.match(/^agent:agent_pg:(\d+)$/);
  if (m) return { kind: 'agent_pg', page: parseInt(m[1], 10) };

  m = data.match(/^agent:leads_pg:([^:]+):(\d+)$/);
  if (m) return { kind: 'leads_pg', status: m[1] === 'all' ? '' : m[1], page: parseInt(m[2], 10) };

  m = data.match(/^agent:hist_pg:(\d+)$/);
  if (m) return { kind: 'hist_pg', page: parseInt(m[1], 10) };

  return null;
}

import type { AgentSession } from '@/lib/db/telegram-agent-sessions';

export type LeadButton = { id: string; label: string };
type Keyboard = { inline_keyboard: { text: string; callback_data: string }[][] };

/** Agent picker keyboard: Main + paginated leads, highlights the currently active one. */
export function buildAgentKeyboard(
  leads: LeadButton[],
  opts: { activeLeadId?: string | null; page?: number } = {}
): Keyboard {
  const { activeLeadId, page = 0 } = opts;
  const isMainActive = activeLeadId === null || activeLeadId === undefined;
  const mainLabel = isMainActive ? '✅ 🤖 Main' : '🤖 Main';

  const rows: { text: string; callback_data: string }[][] = [
    [{ text: mainLabel, callback_data: 'agent:main' }],
  ];

  const paged = leads.slice(page * AGENT_PAGE_SIZE, (page + 1) * AGENT_PAGE_SIZE);
  for (const lead of paged) {
    const isActive = lead.id === activeLeadId;
    rows.push([{
      text: isActive ? `✅ 👤 ${lead.label}` : `👤 ${lead.label}`,
      callback_data: `agent:lead:${lead.id}`,
    }]);
  }

  const nav = buildNavRow(leads.length, page, 'agent:agent_pg');
  if (nav.length) rows.push(nav);

  return { inline_keyboard: rows };
}

/** Leads list keyboard: each lead is a button → detail view on tap. */
export function buildLeadsKeyboard(
  leads: LeadButton[],
  opts: { page?: number; status?: string } = {}
): Keyboard {
  const { page = 0, status = '' } = opts;
  const paged = leads.slice(page * AGENT_PAGE_SIZE, (page + 1) * AGENT_PAGE_SIZE);
  const rows = paged.map((l) => ([{
    text: `👤 ${l.label}`,
    callback_data: `agent:detail:${l.id}`,
  }]));

  const statusKey = status || 'all';
  const nav = buildNavRow(leads.length, page, `agent:leads_pg:${statusKey}`);
  if (nav.length) rows.push(nav);

  return { inline_keyboard: rows };
}

/** Lead history picker keyboard: each lead → show history on tap. */
export function buildLeadPickerKeyboard(leads: LeadButton[], page = 0): Keyboard {
  const paged = leads.slice(page * AGENT_PAGE_SIZE, (page + 1) * AGENT_PAGE_SIZE);
  const rows = paged.map((l) => ([{
    text: `👤 ${l.label}`,
    callback_data: `agent:history:${l.id}`,
  }]));

  const nav = buildNavRow(leads.length, page, 'agent:hist_pg');
  if (nav.length) rows.push(nav);

  return { inline_keyboard: rows };
}

function buildNavRow(total: number, page: number, prefix: string) {
  const row: { text: string; callback_data: string }[] = [];
  if (page > 0) row.push({ text: '◀', callback_data: `${prefix}:${page - 1}` });
  if ((page + 1) * AGENT_PAGE_SIZE < total) row.push({ text: '▶', callback_data: `${prefix}:${page + 1}` });
  return row;
}

export function formatAgentLabel(session: AgentSession | null, leadName?: string | null): string {
  if (session?.agent_kind === 'operator') return `👤 Operator · ${leadName ?? 'lead'}`;
  return '🤖 Main';
}
