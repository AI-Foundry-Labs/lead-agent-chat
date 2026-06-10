import { getConversation, getLeadById } from '@/lib/db';
import { isIdentifiedLead } from '@/lib/leads/is-identified-lead';
import type { Conversation } from '@/lib/types';

export class ConversationAccessError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Listing quick chat: anonymous OK; owned threads require matching session. */
export async function assertLeadChatAccess(
  conversationId: string,
  leadId: string | null
): Promise<Conversation> {
  const conv = await getConversation(conversationId);
  if (!conv || conv.type !== 'lead') {
    throw new ConversationAccessError(404, 'not_found');
  }
  if (conv.lead_id && conv.lead_id !== leadId) {
    // The conversation gained a lead_id mid-chat (e.g. the agent called ensureLead
    // during qualification/booking, or an admin acted on it). An anonymous quick-chat
    // visitor holds the (unguessable) conversation id and still owns the thread until
    // the lead becomes identified (email/name captured) — only then lock out non-owners.
    const lead = await getLeadById(conv.lead_id);
    if (lead && isIdentifiedLead(lead)) {
      throw new ConversationAccessError(403, 'forbidden');
    }
  }
  return conv;
}

/** Threads inbox: caller must own the conversation. */
export async function assertLeadOwnsConversation(
  conversationId: string,
  leadId: string
): Promise<Conversation> {
  const conv = await getConversation(conversationId);
  if (!conv || conv.type !== 'lead' || conv.lead_id !== leadId) {
    throw new ConversationAccessError(404, 'not_found');
  }
  return conv;
}

export function toConversationAccessResponse(e: unknown): Response | null {
  if (e instanceof ConversationAccessError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  return null;
}
