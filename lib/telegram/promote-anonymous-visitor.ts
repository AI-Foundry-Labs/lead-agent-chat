import {
  createLead,
  deleteLead,
  getConversation,
  attachLeadIfAnonymous
} from '@/lib/db';
import { incrementAnonSeq } from '@/lib/db/agencies';
import type { Conversation, Language, Lead, Message } from '@/lib/types';

/**
 * Promote an anonymous (not-logged-in) web visitor into a real lead so the agency
 * can see it in the master agent (/leads, /pool) — even when the visitor only asks
 * questions and never triggers a qualification/booking tool (which is the only
 * other path that creates a lead, via `ensureLead`).
 *
 * Called off the response path after a lead turn once a minimal-signal threshold
 * is reached (≥2 user messages). Guarded: never throws into the web turn.
 *
 * Race-safe: attaching the lead uses a conditional UPDATE (attach only while still
 * anonymous). If a concurrent turn won the race, this call deletes its just-created
 * lead and bails — so no duplicate leads are created.
 *
 * @param opts.language — visitor's detected language for the new lead (defaults to 'fr').
 *
 * Returns the promoted lead, or null when promotion did not happen (already has a
 * lead, conversation vanished, lost the race).
 */
export async function promoteAnonymousVisitor(
  conversation: Conversation,
  agencyId: string,
  // knownMessages kept for call-site compatibility; no longer used since per-lead
  // topic backfill was removed (single-topic UX).
  opts: { language?: Language; knownMessages?: Message[] } = {}
): Promise<Lead | null> {
  // Re-read latest state — a parallel turn may have attached a lead already.
  const fresh = await getConversation(conversation.id);
  if (!fresh || fresh.lead_id) return null;

  // Atomically reserve a per-agency sequence number for a readable lead label.
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

  return lead;
}
