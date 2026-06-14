import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  createConversation,
  getConversation,
  getLeadConversationByChannel,
  getListingById,
  getVisibleMessages,
  getActiveViewing,
  updateConversation
} from '@/lib/db';
import { promoteAnonymousVisitor } from '@/lib/telegram/promote-anonymous-visitor';
import {
  getLeadIdFromCookies,
  setLeadCookie,
  clearGuestConvCookie,
  setGuestConvCookie,
  getGuestConvId
} from '@/lib/auth';
import {
  assertLeadChatAccess,
  toConversationAccessResponse
} from '@/lib/conversation-access';
import { runAgentTurn } from '@/lib/agent/run';
import { getLang } from '@/lib/i18n-server';
import { formatSlot } from '@/lib/format';
import { getDefaultAgency } from '@/lib/db/agencies';

export const runtime = 'nodejs';

const postSchema = z.object({
  // The client sends null before a conversation exists — accept null + undefined.
  conversationId: z.string().uuid().nullish(),
  listingId: z.string().nullish(),
  message: z.string().min(1).max(4000)
});

// GET /api/chat?conversationId= — fetch conversation state + thread (for SSE refetch).
// Also accepts ?listingId= (without conversationId) to restore an anonymous guest session from cookie.
export async function GET(req: NextRequest) {
  let id = req.nextUrl.searchParams.get('conversationId');
  const listingId = req.nextUrl.searchParams.get('listingId');
  const leadId = await getLeadIdFromCookies();
  const agencyId =
    req.headers.get('x-agency-id') ??
    (await getDefaultAgency())?.id;
  if (!agencyId) {
    return Response.json({ error: 'agency_not_configured' }, { status: 503 });
  }

  // No conversationId? Try to restore from guest cookie using listingId.
  if (!id) {
    if (!listingId) return Response.json({ error: 'conversationId required' }, { status: 400 });
    id = await getGuestConvId(listingId);
    if (!id && leadId) {
      const leadConversation = await getLeadConversationByChannel(leadId, listingId, 'web');
      if (leadConversation?.agency_id === agencyId) id = leadConversation.id;
    }
    if (!id) return Response.json({ conversation: null, messages: [], viewing: null });
  }

  let conversation;
  try {
    conversation = await assertLeadChatAccess(id, leadId, agencyId);
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

  // Resolve agency upfront — needed for both access check and new conversation.
  const agencyId =
    req.headers.get('x-agency-id') ??
    (await getDefaultAgency())?.id;
  if (!agencyId) {
    return Response.json({ error: 'agency_not_configured' }, { status: 503 });
  }

  // Resolve existing conversation: prefer explicit conversationId, then guest cookie.
  const resolvedId = conversationId ?? await getGuestConvId(listingId ?? null);
  let conv = null;
  if (resolvedId) {
    try {
      conv = await assertLeadChatAccess(resolvedId, leadId, agencyId);
    } catch (e) {
      // Guest cookie may point to a stale/invalid conversation — fall through to create new.
      if (!conversationId) {
        conv = null;
      } else {
        return toConversationAccessResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
      }
    }
  }
  if (!conv) {
    // Validate listingId belongs to this agency before creating a conversation.
    if (listingId) {
      const listing = await getListingById(listingId);
      if (!listing || listing.agency_id !== agencyId) {
        return Response.json({ error: 'invalid_listing' }, { status: 400 });
      }
    }
    conv = await createConversation({
      agency_id: agencyId,
      type: 'lead',
      listing_id: listingId ?? null,
      lead_id: leadId,
      primary_channel: 'web'
    });
    // Persist new conversationId in guest cookie so page refreshes resume this thread.
    await setGuestConvCookie(conv.id, listingId ?? null);
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
      let promotedLeadId = refreshed?.lead_id ?? null;

      // Still anonymous after the turn (visitor only asked questions, no tool ran)?
      // Promote to an anonymous lead once a minimal-signal threshold is reached so
      // the agency can see this conversation in Telegram. Off-the-happy-path here is
      // fine; promotion is guarded and provisions forum topics best-effort.
      if (refreshed && !refreshed.lead_id) {
        const visible = await getVisibleMessages(conv.id);
        const userMsgCount = visible.filter((m) => m.role === 'user').length;
        if (userMsgCount >= 2) {
          const promoted = await promoteAnonymousVisitor(refreshed, agencyId, {
            language: lang,
            knownMessages: visible
          }).catch((e) => {
            console.error('[chat] promoteAnonymousVisitor failed — non-fatal:', e);
            return null;
          });
          promotedLeadId = promoted?.id ?? null;
        }
      }

      if (promotedLeadId) {
        // Visitor promoted to lead: set persistent session, clear anonymous guest cookie.
        await setLeadCookie(promotedLeadId);
        await clearGuestConvCookie();
      }
    }

    const [refreshed, messages, viewing] = await Promise.all([
      getConversation(conv.id),
      getVisibleMessages(conv.id),
      getActiveViewing(conv.id)
    ]);

    return Response.json({
      conversationId: conv.id,
      reply: result.reply,
      status: result.status,
      conversation: refreshed
        ? {
            id: refreshed.id,
            mode: refreshed.mode,
            listing_id: refreshed.listing_id,
            lead_id: refreshed.lead_id
          }
        : null,
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
  } catch (e) {
    console.error('[chat] turn failed:', e);
    return Response.json(
      { conversationId: conv.id, error: 'agent_error' },
      { status: 500 }
    );
  }
}
