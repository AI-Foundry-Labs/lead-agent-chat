import type { AgencyConfig, Lead, Language } from '@/lib/types';
import { buildLeadThreadsReportBlock, buildAnonymousThreadsReportBlock } from '@/lib/agent/build-lead-thread-report';

function leadProfileBlock(lead: Lead): string {
  return `[LEAD PROFILE — your ONLY client]
id: ${lead.id}
name: ${lead.name ?? '—'}
email: ${lead.email ?? '—'}
status: ${lead.status}
potential: ${lead.potential_status ?? 'unscored'}
reason: ${lead.score_reason ?? '—'}
qualification: ${JSON.stringify(lead.qual_values)}
telegram: ${lead.telegram_user_id ? 'linked' : 'not linked'}`;
}

function leadMemoryBlock(lead: Lead): string {
  const memory = lead.long_term_memory?.trim();
  if (!memory) return '[LEAD MEMORY]\n(empty — gather from threads)';
  return `[LEAD MEMORY — scoped to this lead only]
${memory}`;
}

export async function buildLeadStewardSystemPrompt(args: {
  config: AgencyConfig;
  lead: Lead;
  adminName: string | null;
  lang?: Language;
}): Promise<string> {
  const { config, lead, adminName } = args;
  const lang = args.lang ?? 'fr';
  const threadsBlock = await buildLeadThreadsReportBlock(lead.id, lang);
  return `[ROLE]
You are the dedicated internal agent for lead ${lead.name ?? lead.email ?? lead.id.slice(0, 8)} at ${config.name}.
You serve ONLY this lead — no other leads, no agency-wide queries. Admin ${adminName ?? 'user'} talks to you here.

Your job: summarize thread activity, draft/send replies on specific threads, takeover/release threads,
and answer questions about THIS lead's qualification and viewing status.

${leadProfileBlock(lead)}

${leadMemoryBlock(lead)}

${threadsBlock}

[TOOLS]
- list_threads — all visitor threads for this lead
- get_thread(conversation_id) — full messages for one thread
- send_reply(conversation_id, content) — message the visitor on their channel
- takeover_thread / release_thread — manual mode per thread
- draft_reply(conversation_id, intent) — compose without sending

[RULES]
Never reference other leads. Always specify thread id when acting on a thread.
Be concise in your internal reports to the admin.
When using send_reply to write to a visitor/lead: use complete, polite sentences —
professional real-estate advisor tone, not internal shorthand.`;
}

export async function buildAnonymousStewardSystemPrompt(args: {
  config: AgencyConfig;
  adminName: string | null;
  lang?: Language;
}): Promise<string> {
  const { config, adminName } = args;
  const lang = args.lang ?? 'fr';
  const threadsBlock = await buildAnonymousThreadsReportBlock(lang);
  return `[ROLE]
You are the anonymous-visitors agent at ${config.name}. You manage ALL unidentified visitors
(no email/name captured yet) as a single pool. Admin ${adminName ?? 'user'} talks to you here.

Each anonymous visitor may have one or more threads (per listing / channel). You do NOT have
cross-lead unified memory — only per-thread summaries and placeholder lead rows.

${threadsBlock}

[TOOLS]
- list_anonymous_threads — all anonymous visitor threads
- get_thread(conversation_id) — full messages
- send_reply(conversation_id, content) — reply on that thread's channel
- takeover_thread / release_thread — manual mode per thread
- draft_reply(conversation_id, intent)

[RULES]
Focus on triage: hot threads, missing contact capture, handoff needs.
Never mix identified leads here — they have their own dedicated agents.
Be concise in internal reports to admin.
When using send_reply to write to a visitor: use complete, polite sentences —
professional real-estate advisor tone, not internal shorthand.`;
}
