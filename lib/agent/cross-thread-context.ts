import {
  getConversation,
  getListing,
  listConversationsByLeadId
} from '@/lib/db';
import type { Conversation, Language } from '@/lib/types';

/** Summaries of sibling threads so the agent can unify context across channels. */
export async function buildCrossThreadContextBlock(args: {
  leadId: string;
  currentConversationId: string;
  lang?: Language;
}): Promise<string> {
  const threads = await listConversationsByLeadId(args.leadId);
  const siblings = threads.filter((t) => t.id !== args.currentConversationId);
  if (siblings.length === 0) return '';

  const en = args.lang === 'en';
  const lines: string[] = [];

  for (const t of siblings) {
    const listing = t.listing_id ? await getListing(t.listing_id) : null;
    const listingLabel = listing
      ? en
        ? listing.title_en
        : listing.title
      : 'general';
    const summary = t.thread_summary?.trim() || '(no rolled summary yet — thread may be short)';
    lines.push(
      `- [${t.primary_channel} · ${listingLabel} · thread:${t.id.slice(0, 8)}] ${summary}`
    );
  }

  return `[OTHER THREADS FOR THIS VISITOR — separate chat sessions, shared profile]
Each line is a different channel/listing thread. Use with long-term memory to avoid
contradictions and to reference what they already discussed elsewhere (without claiming
you saw messages from the other thread verbatim).
${lines.join('\n')}`;
}

export async function threadMemoryTag(conversationId: string): Promise<string> {
  const conv = await getConversation(conversationId);
  if (!conv) return `thread:${conversationId.slice(0, 8)}`;
  const listing = conv.listing_id ? await getListing(conv.listing_id) : null;
  const listingPart = listing ? listing.id : 'general';
  return `${conv.primary_channel} · ${listingPart} · thread:${conv.id.slice(0, 8)}`;
}

export function formatConversationForMemory(conv: Conversation): string {
  return `${conv.primary_channel} · listing:${conv.listing_id ?? 'general'} · thread:${conv.id.slice(0, 8)}`;
}
