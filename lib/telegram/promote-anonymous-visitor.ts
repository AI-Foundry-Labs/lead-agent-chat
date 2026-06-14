import {
  createLead,
  deleteLead,
  getConversation,
  getListing,
  getVisibleMessages,
  attachLeadIfAnonymous
} from '@/lib/db';
import { incrementAnonSeq } from '@/lib/db/agencies';
import type { Conversation, Language, Lead, Message } from '@/lib/types';
import type { LeadTelegramTopics } from '@/lib/db/lead-telegram-topics';
import { getOrCreateLeadTopics } from './lead-topics';
import { enqueueGroupSend } from './group-send-queue';

/**
 * Promote an anonymous (not-logged-in) web visitor into a real lead so the agency
 * can see the conversation in Telegram — even when the visitor only asks questions
 * and never triggers a qualification/booking tool (which is the only other path
 * that creates a lead, via `ensureLead`).
 *
 * Called off the response path after a lead turn once a minimal-signal threshold
 * is reached (≥2 user messages). Guarded: never throws into the web turn.
 *
 * Race-safe: attaching the lead uses a conditional UPDATE (attach only while still
 * anonymous). If a concurrent turn won the race, this call deletes its just-created
 * lead and bails BEFORE provisioning topics — so no duplicate leads or duplicate
 * Telegram topic pairs are created.
 *
 * @param opts.language — visitor's detected language for the new lead (defaults to 'fr').
 * @param opts.knownMessages — already-loaded visible messages, reused for backfill (saves a query).
 *
 * Returns the promoted lead, or null when promotion did not happen (already has a
 * lead, conversation vanished, lost the race).
 */
export async function promoteAnonymousVisitor(
  conversation: Conversation,
  agencyId: string,
  opts: { language?: Language; knownMessages?: Message[] } = {}
): Promise<Lead | null> {
  // Re-read latest state — a parallel turn may have attached a lead already.
  const fresh = await getConversation(conversation.id);
  if (!fresh || fresh.lead_id) return null;

  // Atomically reserve a per-agency sequence number for a readable topic title.
  const anonSeq = await incrementAnonSeq(agencyId);

  const lead = await createLead({
    agency_id: agencyId,
    channel: fresh.primary_channel,
    listing_id: fresh.listing_id,
    language: opts.language,
    anon_seq: anonSeq
  });

  // Conditional attach: only succeeds if the conversation is still anonymous.
  // Loses to a concurrent promotion → delete our orphan lead and stop here.
  const attached = await attachLeadIfAnonymous(fresh.id, lead.id);
  if (!attached) {
    await deleteLead(lead.id).catch((err) =>
      console.error('[promote-anon] orphan lead cleanup failed', lead.id, err)
    );
    return null;
  }

  // Provision the agency's forum topics for this lead (no-op if agency hasn't
  // linked a group / disabled topics). Guarded so Telegram failure can't break us.
  // Because the lead is brand-new (and we won the attach race), a non-null result
  // means the topics were just created — so we seed context + backfill once.
  const topics = await getOrCreateLeadTopics(agencyId, lead.id).catch((err) => {
    console.error('[promote-anon] getOrCreateLeadTopics failed for lead', lead.id, err);
    return null;
  });
  if (topics) {
    await seedAndBackfillTopic(attached, lead, topics, opts.knownMessages).catch((err) =>
      console.error('[promote-anon] seed/backfill failed for lead', lead.id, err)
    );
  }

  return lead;
}

/**
 * After a fresh anonymous lead's 💬 Conversation topic is created, the earlier
 * turns (which happened before the topic existed) were never mirrored. Post a
 * one-line context header, then backfill the existing visible messages so the
 * agency sees the full conversation, not just turns from now on.
 *
 * Best-effort: enqueued onto the per-group throttle queue. The header is
 * 'critical' (never dropped); backfilled turns are 'mirror' (droppable under load).
 */
async function seedAndBackfillTopic(
  conversation: Conversation,
  lead: Lead,
  topics: LeadTelegramTopics,
  knownMessages?: Message[]
): Promise<void> {
  const threadId = topics.conversation_topic_id;
  if (!threadId) return;
  const groupChatId = topics.group_chat_id;

  // Context header: who, which listing, language, when the visit started.
  const listing = conversation.listing_id
    ? await getListing(conversation.listing_id)
    : null;
  const who = lead.anon_seq != null ? `Visiteur #${lead.anon_seq}` : 'Visiteur';
  const startedAt = conversation.created_at
    .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const headerParts = [
    `📋 ${who}`,
    listing?.title ? `Annonce: ${listing.title}` : null,
    `Langue: ${lead.language}`,
    `Début: ${startedAt}`
  ].filter(Boolean);
  enqueueGroupSend(groupChatId, headerParts.join(' • '), {
    threadId,
    kind: 'critical'
  });

  // Backfill prior turns in order. Only lead/agent content (skip tool/system rows).
  const visible = knownMessages ?? (await getVisibleMessages(conversation.id));
  for (const m of visible) {
    if (!m.content?.trim()) continue;
    let prefix: string | null = null;
    if (m.role === 'user') prefix = '🧑 Lead';
    else if (m.role === 'assistant') prefix = '🤖 Agent';
    else if (m.role === 'admin') prefix = '🧑‍💼 Conseiller';
    if (!prefix) continue;
    enqueueGroupSend(groupChatId, `${prefix}: ${m.content}`, {
      threadId,
      kind: 'mirror'
    });
  }
}
