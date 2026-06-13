import { createLead, getLeadById, updateConversation } from '@/lib/db';
import type { Conversation, Lead } from '@/lib/types';
import { getOrCreateLeadTopics } from './lead-topics';

/** Ensure a lead row exists for linking / telegram routing from a web conversation. */
export async function ensureLeadForConversation(
  conversation: Conversation,
  agencyId: string
): Promise<Lead> {
  if (conversation.lead_id) {
    const existing = await getLeadById(conversation.lead_id);
    if (existing) return existing;
  }
  const lead = await createLead({
    agency_id: agencyId,
    channel: conversation.primary_channel,
    listing_id: conversation.listing_id
  });
  await updateConversation(conversation.id, { lead_id: lead.id });

  // Fire-and-forget: provision forum topics off the response path (red-team M1).
  // Must never throw into the web turn; Telegram failure is logged and silenced.
  getOrCreateLeadTopics(agencyId, lead.id).catch((err) =>
    console.error('[ensure-lead] getOrCreateLeadTopics failed for lead', lead.id, err)
  );

  return lead;
}
