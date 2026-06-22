import {
  createLead,
  getLeadById,
  updateConversation
} from '@/lib/db';
import type { AgencyConfig, Conversation, Language, Lead } from '@/lib/types';

// Shared context handed to every tool's execute closure. Mutable so that lazily
// creating/attaching a lead during a turn is visible to later tool calls.
export interface AgentContext {
  conversation: Conversation;
  config: AgencyConfig;
  lang: Language;
}

// A lead-facing conversation may start anonymous (conversation.lead_id == null).
// The first tool that needs a lead (record_qualification, book_viewing) lazily
// creates one and attaches it to the conversation.
export async function ensureLead(ctx: AgentContext): Promise<Lead> {
  if (ctx.conversation.lead_id) {
    const existing = await getLeadById(ctx.conversation.lead_id);
    if (existing) return existing;
  }
  const lead = await createLead({
    agency_id: ctx.config.agency_id,
    channel: ctx.conversation.primary_channel,
    listing_id: ctx.conversation.listing_id
  });
  ctx.conversation = await updateConversation(ctx.conversation.id, {
    lead_id: lead.id
  });

  return lead;
}
