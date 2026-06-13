import {
  getListing,
  listConversationsByLeadId,
  listAnonymousVisitorThreads
} from '@/lib/db';
import type { Conversation, Language } from '@/lib/types';

async function formatThreadLine(
  t: Conversation,
  lang: Language
): Promise<string> {
  const listing = t.listing_id ? await getListing(t.listing_id) : null;
  const listingLabel = listing
    ? lang === 'en'
      ? listing.title_en
      : listing.title
    : 'general';
  const summary = t.thread_summary?.trim() || '(short thread — no rolled summary yet)';
  // Full conversation_id — get_thread / send_reply require the complete UUID.
  return `- conversation_id:${t.id} · ${t.primary_channel} · ${listingLabel} · mode:${t.mode} · updated:${t.updated_at.toISOString().slice(0, 10)}\n  ${summary}`;
}

export async function buildLeadThreadsReportBlock(
  leadId: string,
  lang: Language = 'fr'
): Promise<string> {
  const threads = await listConversationsByLeadId(leadId);
  if (threads.length === 0) {
    return '[VISITOR THREADS]\nNo visitor-facing threads yet for this lead.';
  }
  const lines = await Promise.all(threads.map((t) => formatThreadLine(t, lang)));
  return `[VISITOR THREADS — report by thread for this lead only]
Each line is a separate visitor chat (web / telegram / email). Use list_threads / get_thread tools for full messages.
${lines.join('\n')}`;
}

export async function buildAnonymousThreadsReportBlock(
  agencyId: string,
  lang: Language = 'fr'
): Promise<string> {
  const threads = await listAnonymousVisitorThreads(agencyId);
  if (threads.length === 0) {
    return '[ANONYMOUS VISITOR THREADS]\nNo active anonymous threads.';
  }
  const lines = await Promise.all(threads.slice(0, 30).map((t) => formatThreadLine(t, lang)));
  const extra =
    threads.length > 30 ? `\n… and ${threads.length - 30} more (use list_anonymous_threads).` : '';
  return `[ANONYMOUS VISITOR THREADS — unidentified visitors only]
These are separate quick chats before identity capture. Each thread may map to a placeholder lead row.
${lines.join('\n')}${extra}`;
}
