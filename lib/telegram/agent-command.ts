// Pure parsing/rendering helpers for the Telegram /agent hub. No I/O here.

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

export type AgentCallback = { kind: 'main' } | { kind: 'lead'; leadId: string } | null;

export function parseAgentCallback(data: string): AgentCallback {
  if (data === 'agent:main') return { kind: 'main' };
  const m = data.match(/^agent:lead:(.+)$/);
  if (m) return { kind: 'lead', leadId: m[1] };
  return null;
}

import type { AgentSession } from '@/lib/db/telegram-agent-sessions';

export type LeadButton = { id: string; label: string };

export function buildAgentKeyboard(
  leads: LeadButton[],
  max = 8
): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows: { text: string; callback_data: string }[][] = [
    [{ text: '🤖 Main', callback_data: 'agent:main' }]
  ];
  for (const lead of leads.slice(0, max)) {
    rows.push([{ text: `👤 ${lead.label}`, callback_data: `agent:lead:${lead.id}` }]);
  }
  return { inline_keyboard: rows };
}

export function formatAgentLabel(session: AgentSession | null, leadName?: string | null): string {
  if (session?.agent_kind === 'operator') return `👤 Operator · ${leadName ?? 'lead'}`;
  return '🤖 Main';
}
