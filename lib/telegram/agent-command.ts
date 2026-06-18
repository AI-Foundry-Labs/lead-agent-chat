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
