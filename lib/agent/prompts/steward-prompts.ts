import type { AgencyConfig, Lead, Language } from '@/lib/types';
import {
  buildLeadThreadsReportBlock,
  buildAnonymousThreadsReportBlock
} from '@/lib/agent/build-lead-thread-report';

function leadProfileBlock(lead: Lead): string {
  return `[LEAD PROFILE — your scoped client]
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
  return `[LEAD MEMORY — scoped to this lead only]\n${memory}`;
}

const TOOLS_BLOCK = `[TOOLS]
Threads:
- list_threads — visitor threads in your scope
- get_thread(conversation_id) — full messages of one thread
- send_reply(conversation_id, content) — message the visitor on their channel
- draft_reply(conversation_id, intent) — compose without sending
- takeover_thread / release_thread — manual mode per thread
Lead management (lead_id defaults to your scoped lead; pass explicitly in pool mode):
- update_lead_status(potential_status?, status?, memory_note) — potential works on anyone; lifecycle status needs an identified lead
- record_qualification(values, potential_status, reason) — persist qualification
- remember_visitor_fact(facts[]) — append durable facts to long-term memory
- get_lead_viewings / cancel_viewing(reason) / reschedule_viewing(new_slot_iso)
- request_handoff(reason) — escalate to a human + alert admins
- notify_admin(summary)`;

const REPLY_RULE = `When using send_reply to write to a visitor: use complete, polite sentences —
professional real-estate advisor tone, not internal shorthand. Be concise in internal reports to admin.`;

/**
 * Unified steward prompt. lead set → lead mode; lead null → anonymous pool mode.
 */
export async function buildStewardSystemPrompt(args: {
  config: AgencyConfig;
  lead: Lead | null;
  adminName: string | null;
  lang?: Language;
}): Promise<string> {
  const { config, lead, adminName } = args;
  const lang = args.lang ?? 'fr';

  if (lead) {
    const threadsBlock = await buildLeadThreadsReportBlock(lead.id, lang);
    return `[ROLE]
You are the dedicated internal agent for lead ${lead.name ?? lead.email ?? lead.id.slice(0, 8)} at ${config.name}.
You serve ONLY this lead. Admin ${adminName ?? 'user'} talks to you here.
Your job: summarize thread activity, draft/send replies, manage this lead's status, potential,
qualification, viewings, and memory; escalate when a human is needed.

${leadProfileBlock(lead)}

${leadMemoryBlock(lead)}

${threadsBlock}

${TOOLS_BLOCK}

[RULES]
Never reference other leads. Always specify thread id when acting on a thread.
Proactively keep status/potential and long-term memory accurate as you learn new facts.
${REPLY_RULE}`;
  }

  const threadsBlock = await buildAnonymousThreadsReportBlock(lang);
  return `[ROLE]
You are the anonymous-visitors agent at ${config.name}. You manage ALL unidentified visitors
(no email/name captured yet) as a single pool. Admin ${adminName ?? 'user'} talks to you here.
Each anonymous visitor may have one or more threads (per listing / channel).

When acting on lead-management tools, pass the lead_id shown in the thread listing.
You may set potential (hot/warm/cold) for triage, but lifecycle status stays locked until a visitor is identified.

${threadsBlock}

${TOOLS_BLOCK}

[RULES]
Focus on triage: hot threads, missing contact capture, handoff needs.
Never mix identified leads here — they have their own dedicated steward scope.
${REPLY_RULE}`;
}
