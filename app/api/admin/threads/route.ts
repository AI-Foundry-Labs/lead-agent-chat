import { type NextRequest } from 'next/server';
import {
  getLeadById,
  listConversationsByLeadId,
  listAnonymousVisitorThreads,
  getConversation,
  getListing,
  getVisibleMessages
} from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';

export const runtime = 'nodejs';

/** Thread-centric reporting for admin — list or detail one visitor thread. */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const leadId = req.nextUrl.searchParams.get('lead_id');
    const scope = req.nextUrl.searchParams.get('scope');
    const conversationId = req.nextUrl.searchParams.get('conversation_id');

    if (conversationId) {
      const conv = await getConversation(conversationId);
      if (!conv || conv.type !== 'lead') {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }
      const lead = conv.lead_id ? await getLeadById(conv.lead_id) : null;
      const listing = conv.listing_id ? await getListing(conv.listing_id) : null;
      const messages = await getVisibleMessages(conversationId);
      return Response.json({
        thread: {
          id: conv.id,
          lead_id: conv.lead_id,
          channel: conv.primary_channel,
          listing_id: conv.listing_id,
          listing_title: listing?.title ?? null,
          mode: conv.mode,
          thread_summary: conv.thread_summary,
          updated_at: conv.updated_at
        },
        lead: lead
          ? {
              id: lead.id,
              name: lead.name,
              email: lead.email,
              status: lead.status,
              potential: lead.potential_status,
              qual_values: lead.qual_values,
              long_term_memory: lead.long_term_memory
            }
          : null,
        messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))
      });
    }

    if (scope === 'anonymous') {
      const threads = await listAnonymousVisitorThreads();
      const enriched = await Promise.all(
        threads.map(async (t) => {
          const listing = t.listing_id ? await getListing(t.listing_id) : null;
          return {
            id: t.id,
            lead_id: t.lead_id,
            channel: t.primary_channel,
            listing_id: t.listing_id,
            listing_title: listing?.title ?? null,
            mode: t.mode,
            thread_summary: t.thread_summary,
            updated_at: t.updated_at
          };
        })
      );
      return Response.json({ threads: enriched });
    }

    if (!leadId) {
      return Response.json({ error: 'lead_id_or_scope_required' }, { status: 400 });
    }

    const lead = await getLeadById(leadId);
    if (!lead) return Response.json({ error: 'not_found' }, { status: 404 });

    const threads = await listConversationsByLeadId(leadId);
    const enriched = await Promise.all(
      threads.map(async (t) => {
        const listing = t.listing_id ? await getListing(t.listing_id) : null;
        return {
          id: t.id,
          channel: t.primary_channel,
          listing_id: t.listing_id,
          listing_title: listing?.title ?? null,
          mode: t.mode,
          thread_summary: t.thread_summary,
          updated_at: t.updated_at
        };
      })
    );

    return Response.json({
      lead: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        status: lead.status,
        potential: lead.potential_status,
        qual_values: lead.qual_values,
        long_term_memory: lead.long_term_memory
      },
      threads: enriched
    });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}
