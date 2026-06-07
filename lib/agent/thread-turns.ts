import type { Message } from '@/lib/types';

export type ThreadTurn = { user: Message; replies: Message[] };

/** One turn = one user message plus following assistant/admin replies. */
export function groupMessagesIntoTurns(messages: Message[]): ThreadTurn[] {
  const turns: ThreadTurn[] = [];
  let current: ThreadTurn | null = null;

  for (const m of messages) {
    if (m.role === 'user') {
      if (current) turns.push(current);
      current = { user: m, replies: [] };
      continue;
    }
    if (current && (m.role === 'assistant' || m.role === 'admin')) {
      current.replies.push(m);
    }
  }
  if (current) turns.push(current);
  return turns;
}

export function formatTurnsForSummary(turns: ThreadTurn[]): string {
  return turns
    .map((t) => {
      const replies = t.replies.map((r) => `Assistant: ${r.content}`).join('\n');
      return `User: ${t.user.content}${replies ? `\n${replies}` : ''}`;
    })
    .join('\n\n');
}

export function flattenRecentTurns(turns: ThreadTurn[]): Message[] {
  const out: Message[] = [];
  for (const t of turns) {
    out.push(t.user, ...t.replies);
  }
  return out;
}
