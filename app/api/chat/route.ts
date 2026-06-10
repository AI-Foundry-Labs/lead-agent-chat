import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  createConversation,
  getConversation,
  getVisibleMessages,
  getActiveViewing,
  updateConversation
} from '@/lib/db';
import { getLeadIdFromCookies, setLeadCookie } from '@/lib/auth';
import {
  assertLeadChatAccess,
  toConversationAccessResponse
} from '@/lib/conversation-access';
import { runAgentTurn } from '@/lib/agent/run';
import { getLang } from '@/lib/i18n-server';
import { formatSlot } from '@/lib/format';

export const runtime = 'nodejs';

const postSchema = z.object({
  // The client sends null before a conversation exists — accept null + undefined.
  conversationId: z.string().uuid().nullish(),
  listingId: z.string().nullish(),
  message: z.string().min(1).max(4000)
});

// GET /api/chat?conversationId= — fetch conversation state + thread (for SSE refetch).
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('conversationId');
  if (!id) return Response.json({ error: 'conversationId required' }, { status: 400 });
  const leadId = await getLeadIdFromCookies();
  let conversation;
  try {
    conversation = await assertLeadChatAccess(id, leadId);
  } catch (e) {
    return toConversationAccessResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
  const messages = await getVisibleMessages(id);
  const viewing = await getActiveViewing(id);
  return Response.json({
    conversation: {
      id: conversation.id,
      mode: conversation.mode,
      listing_id: conversation.listing_id,
      lead_id: conversation.lead_id
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls
    })),
    viewing:
      viewing && viewing.status === 'booked' && viewing.confirmed_slot
        ? {
            listing_id: viewing.listing_id,
            slot: viewing.confirmed_slot.toISOString()
          }
        : null
  });
}

// POST /api/chat — create (if needed) and run one lead turn.
export async function POST(req: NextRequest) {
  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { conversationId, listingId, message } = parsed.data;
  const leadId = await getLeadIdFromCookies();

  let conv = null;
  if (conversationId) {
    try {
      conv = await assertLeadChatAccess(conversationId, leadId);
    } catch (e) {
      return toConversationAccessResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
    }
  }
  if (!conv) {
    conv = await createConversation({
      type: 'lead',
      listing_id: listingId ?? null,
      lead_id: leadId,
      primary_channel: 'web'
    });
  } else if (leadId && !conv.lead_id) {
    // A visitor logged in mid-conversation — attach their lead identity.
    conv = await updateConversation(conv.id, { lead_id: leadId });
  }

  try {
    const lang = await getLang();
    const result = await runAgentTurn(conv.id, message, { type: 'lead' }, lang);

    // If the agent created/attached a lead during this turn (e.g. via ensureLead
    // during booking), the visitor's cookie is still anonymous. Refresh the
    // conversation and set the lead cookie so subsequent requests aren't 403'd.
    if (!leadId) {
      const refreshed = await getConversation(conv.id);
      if (refreshed?.lead_id) {
        await setLeadCookie(refreshed.lead_id);
      }
    }

    return Response.json({
      conversationId: conv.id,
      reply: result.reply,
      status: result.status
    });
  } catch (e) {
    console.error('[chat] turn failed:', e);
    return Response.json(
      { conversationId: conv.id, error: 'agent_error' },
      { status: 500 }
    );
  }
}
