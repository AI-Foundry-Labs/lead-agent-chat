import { tool, generateText } from 'ai';
import { z } from 'zod';
import {
  listLeads,
  getLeadById,
  getConversationByLeadId,
  getVisibleMessages,
  addMessage,
  updateConversation,
  updateCriteria,
  upsertAgencyConfig
} from '@/lib/db';
import { MODEL } from '@/lib/llm';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import { criterionSchema } from '@/lib/types';
import type { AgentContext } from './context';

export function buildAdminTools(ctx: AgentContext) {
  return {
    query_leads: tool({
      description: 'List/search leads by status, potential, listing, or recency.',
      inputSchema: z.object({
        status: z
          .enum(['active', 'qualified', 'booked', 'handoff', 'abandoned'])
          .optional(),
        potential: z.enum(['hot', 'warm', 'cold']).optional(),
        listing_id: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional()
      }),
      execute: async ({ status, potential, listing_id, limit }) => {
        let leads = await listLeads();
        if (status) leads = leads.filter((l) => l.status === status);
        if (potential) leads = leads.filter((l) => l.potential_status === potential);
        if (listing_id) leads = leads.filter((l) => l.listing_id === listing_id);
        return leads.slice(0, limit ?? 20).map((l) => ({
          id: l.id,
          email: l.email,
          name: l.name,
          listing_id: l.listing_id,
          status: l.status,
          potential: l.potential_status,
          reason: l.score_reason,
          updated_at: l.updated_at
        }));
      }
    }),

    get_conversation: tool({
      description: "Read a lead's full thread and qualification state.",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const lead = await getLeadById(lead_id);
        if (!lead) return { error: 'lead_not_found' };
        const conv = await getConversationByLeadId(lead_id);
        const messages = conv ? await getVisibleMessages(conv.id) : [];
        return {
          lead: {
            email: lead.email,
            name: lead.name,
            status: lead.status,
            potential: lead.potential_status,
            qual_values: lead.qual_values
          },
          conversation_id: conv?.id ?? null,
          mode: conv?.mode ?? null,
          messages: messages.map((m) => ({ role: m.role, content: m.content }))
        };
      }
    }),

    draft_reply: tool({
      description:
        'Compose a draft reply to a lead (saved for review, not sent). Returns the draft text.',
      inputSchema: z.object({ lead_id: z.string(), intent: z.string().max(400) }),
      execute: async ({ lead_id, intent }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        const history = await getVisibleMessages(conv.id);
        const transcript = history
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n');
        const { text } = await generateText({
          model: MODEL,
          prompt: `You are a real-estate agent at ${ctx.config.name}. Draft a reply to this lead.
Intent: ${intent}
Tone: ${ctx.config.tone}

CONVERSATION:
${transcript}

Write only the reply text.`
        });
        await addMessage({
          conversation_id: conv.id,
          role: 'assistant',
          content: text,
          is_draft: true
        });
        broadcastConversationUpdate(conv.id);
        return { ok: true, draft: text };
      }
    }),

    send_reply: tool({
      description: "Send a message to a lead on their channel (web/email).",
      inputSchema: z.object({ lead_id: z.string(), content: z.string().min(1) }),
      execute: async ({ lead_id, content }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await addMessage({ conversation_id: conv.id, role: 'admin', content });
        await dispatchReply(conv, content);
        broadcastConversationUpdate(conv.id);
        return { ok: true, sent: true };
      }
    }),

    takeover_conversation: tool({
      description:
        "Switch a lead's conversation to manual mode — the lead-facing agent stops auto-replying.",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await updateConversation(conv.id, { mode: 'manual' });
        broadcastConversationUpdate(conv.id);
        return { ok: true, mode: 'manual' };
      }
    }),

    update_criteria: tool({
      description:
        'Replace the agency qualification criteria. Takes effect on the next lead turn.',
      inputSchema: z.object({ criteria: z.array(criterionSchema).min(1) }),
      execute: async ({ criteria }) => {
        ctx.config = await updateCriteria(criteria);
        return { ok: true, criteria: ctx.config.qualification_criteria };
      }
    }),

    update_config: tool({
      description: 'Adjust the agency name and/or tone.',
      inputSchema: z.object({
        name: z.string().max(255).optional(),
        tone: z.string().max(1000).optional()
      }),
      execute: async ({ name, tone }) => {
        ctx.config = await upsertAgencyConfig({
          ...ctx.config,
          name: name ?? ctx.config.name,
          tone: tone ?? ctx.config.tone
        });
        return { ok: true, name: ctx.config.name };
      }
    })
  };
}
