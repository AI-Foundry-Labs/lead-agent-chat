import { createLead, getLeadById, updateConversation } from '@/lib/db';
import type { Conversation, Lead } from '@/lib/types';

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

  return lead;
}
