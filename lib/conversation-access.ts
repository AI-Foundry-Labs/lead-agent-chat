import { getConversation } from '@/lib/db';
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
    throw new ConversationAccessError(403, 'forbidden');
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
