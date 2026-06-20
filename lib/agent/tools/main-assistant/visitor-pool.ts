import { tool } from 'ai';
import { z } from 'zod';
import {
  getConversation,
  getLeadById,
  getVisibleMessages,
  updateLead,
  listAnonymousVisitorThreads
} from '@/lib/db';
import { isIdentifiedLead } from '@/lib/leads/is-identified-lead';
import { promoteAnonymousVisitor } from '@/lib/telegram/promote-anonymous-visitor';
import { syncLeadTopicTitles } from '@/lib/telegram/sync-lead-topic-titles';
import { broadcastAgencyDataChanged } from '@/lib/events';
import { recordAudit } from '@/lib/db';
import type { AgentContext } from '@/lib/agent/tools/context';
import type { Conversation } from '@/lib/types';

// F1 — let main_assistant see and triage the anonymous/unidentified visitor pool
// (previously operator-only). Identify-in-place ONLY (no merge). A visitor is NOT
// persisted as an identified lead unless a name or email is provided.
export function buildVisitorPoolTools(ctx: AgentContext, adminId: string) {
  const agencyId = ctx.config.agency_id;

  // A conversation is "in the pool" when it is an agency lead-thread that is still
  // anonymous (no lead) OR attached to an unidentified lead (no name/email yet).
  const assertPoolThread = async (
    conversationId: string
  ): Promise<Conversation | null> => {
    const conv = await getConversation(conversationId);
    if (!conv || conv.type !== 'lead' || conv.agency_id !== agencyId) return null;
    if (!conv.lead_id) return conv;
    const lead = await getLeadById(conv.lead_id);
    if (lead && isIdentifiedLead(lead)) return null; // already identified
    return conv;
  };

  return {
    list_visitor_pool: tool({
      description:
        'List anonymous / unidentified visitor threads (the triage pool) — visitors not yet ' +
        'captured as named leads. Use to find prospects to follow up or identify.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      execute: async ({ limit }) => {
        const threads = await listAnonymousVisitorThreads(agencyId);
        return threads.slice(0, limit ?? 25).map((t) => ({
          conversation_id: t.id,
          lead_id: t.lead_id,
          channel: t.primary_channel,
          listing_id: t.listing_id,
          mode: t.mode,
          thread_summary: t.thread_summary,
          updated_at: t.updated_at
        }));
      }
    }),

    read_visitor_thread: tool({
      description: 'Read the full message history of one anonymous/unidentified visitor thread.',
      inputSchema: z.object({ conversation_id: z.string().uuid() }),
      execute: async ({ conversation_id }) => {
        const conv = await assertPoolThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_already_identified' };
        const messages = await getVisibleMessages(conversation_id);
        return {
          conversation_id,
          lead_id: conv.lead_id,
          channel: conv.primary_channel,
          listing_id: conv.listing_id,
          messages: messages.map((m) => ({ role: m.role, content: m.content }))
        };
      }
    }),

    identify_visitor: tool({
      description:
        'Identify a pool visitor by attaching a name and/or email — promotes them to a real lead ' +
        'visible in query_leads. Requires at least one of name/email (a visitor with neither is ' +
        'never saved as a lead).',
      inputSchema: z.object({
        conversation_id: z.string().uuid(),
        name: z.string().max(255).optional(),
        email: z.string().email().max(255).optional()
      }),
      execute: async ({ conversation_id, name, email }) => {
        if (!name?.trim() && !email?.trim())
          return { error: 'name_or_email_required' };

        const conv = await assertPoolThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_already_identified' };

        // Resolve (or create) the underlying lead. promoteAnonymousVisitor is
        // race-safe and also provisions Telegram topics + backfills history.
        let leadId = conv.lead_id;
        if (!leadId) {
          const promoted = await promoteAnonymousVisitor(conv, agencyId);
          leadId = promoted?.id ?? (await getConversation(conversation_id))?.lead_id ?? null;
          if (!leadId) return { error: 'could_not_create_lead' };
        }

        const patch: { name?: string; email?: string } = {};
        if (name?.trim()) patch.name = name.trim();
        if (email?.trim()) patch.email = email.trim();
        const updated = await updateLead(leadId, patch);

        // Reflect the real identity on the Telegram topic titles (off the path).
        void syncLeadTopicTitles(agencyId, leadId).catch((e) =>
          console.error('[visitor-pool] syncLeadTopicTitles failed', e)
        );
        await recordAudit({ agency_id: agencyId, admin_id: adminId, action: 'lead_identified', target_lead_id: leadId });
        broadcastAgencyDataChanged(agencyId);

        return {
          ok: true,
          lead_id: leadId,
          name: updated.name,
          email: updated.email,
          status: updated.status
        };
      }
    })
  };
}
