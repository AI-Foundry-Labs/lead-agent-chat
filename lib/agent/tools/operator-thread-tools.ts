/**
 * Operator thread tools — read/draft/send/takeover visitor threads.
 * Works in two scopes determined by scopedLeadId:
 *   - lead mode (scopedLeadId set): only threads belonging to that lead
 *   - pool mode (scopedLeadId null): only anonymous / unidentified visitor threads
 */
import { tool, generateText } from 'ai';
import { z } from 'zod';
import {
  getConversation,
  getLeadById,
  getVisibleMessages,
  addMessage,
  updateConversation,
  listConversationsByLeadId,
  listAnonymousVisitorThreads
} from '@/lib/db';
import { isIdentifiedLead } from '@/lib/leads/is-identified-lead';
import { MODEL } from '@/lib/llm';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import type { Conversation } from '@/lib/types';
import type { AgentContext } from './context';

export function buildOperatorThreadTools(ctx: AgentContext, scopedLeadId: string | null) {
  // Assert a conversation is in scope for this operator (lead-owned OR anonymous in pool mode).
  const assertThread = async (conversationId: string): Promise<Conversation | null> => {
    const conv = await getConversation(conversationId);
    if (!conv || conv.type !== 'lead') return null;
    if (scopedLeadId) return conv.lead_id === scopedLeadId ? conv : null;
    // pool mode: only anonymous / unidentified
    if (!conv.lead_id) return conv;
    const lead = await getLeadById(conv.lead_id);
    if (lead && isIdentifiedLead(lead)) return null;
    return conv;
  };

  return {
    list_threads: tool({
      description: scopedLeadId
        ? 'List all visitor-facing threads for this lead.'
        : 'List all anonymous / unidentified visitor threads (the triage pool).',
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      execute: async ({ limit }) => {
        const threads = scopedLeadId
          ? await listConversationsByLeadId(scopedLeadId)
          : await listAnonymousVisitorThreads(ctx.config.agency_id);
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

    get_thread: tool({
      description: 'Read full messages for one in-scope visitor thread.',
      inputSchema: z.object({ conversation_id: z.string().uuid() }),
      execute: async ({ conversation_id }) => {
        const conv = await assertThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_out_of_scope' };
        const messages = await getVisibleMessages(conversation_id);
        return {
          conversation_id,
          lead_id: conv.lead_id,
          channel: conv.primary_channel,
          mode: conv.mode,
          listing_id: conv.listing_id,
          messages: messages.map((m) => ({ role: m.role, content: m.content }))
        };
      }
    }),

    draft_reply: tool({
      description: 'Draft a reply for one thread (saved, not sent).',
      inputSchema: z.object({
        conversation_id: z.string().uuid(),
        intent: z.string().max(400)
      }),
      execute: async ({ conversation_id, intent }) => {
        const conv = await assertThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_out_of_scope' };
        const history = await getVisibleMessages(conversation_id);
        const transcript = history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
        const { text } = await generateText({
          model: MODEL,
          prompt: `Draft a reply for this real-estate visitor thread at ${ctx.config.name}.
Intent: ${intent}
Tone: ${ctx.config.tone}

THREAD:
${transcript}

Write only the reply text.`
        });
        await addMessage({ conversation_id, role: 'assistant', content: text, is_draft: true });
        broadcastConversationUpdate(conversation_id);
        return { ok: true, draft: text };
      }
    }),

    send_reply: tool({
      description: 'Send a message to the visitor on their thread channel.',
      inputSchema: z.object({
        conversation_id: z.string().uuid(),
        content: z.string().min(1)
      }),
      execute: async ({ conversation_id, content }) => {
        const conv = await assertThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_out_of_scope' };
        await addMessage({ conversation_id, role: 'admin', content });
        await dispatchReply(conv, content);
        broadcastConversationUpdate(conversation_id);
        return { ok: true, sent: true, conversation_id };
      }
    }),

    takeover_thread: tool({
      description: 'Switch a visitor thread to manual mode (AI stops auto-replying).',
      inputSchema: z.object({ conversation_id: z.string().uuid() }),
      execute: async ({ conversation_id }) => {
        const conv = await assertThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_out_of_scope' };
        await updateConversation(conversation_id, { mode: 'manual' });
        broadcastConversationUpdate(conversation_id);
        return { ok: true, mode: 'manual', conversation_id };
      }
    }),

    release_thread: tool({
      description: 'Return a visitor thread to AI agent mode.',
      inputSchema: z.object({ conversation_id: z.string().uuid() }),
      execute: async ({ conversation_id }) => {
        const conv = await assertThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_out_of_scope' };
        await updateConversation(conversation_id, { mode: 'agent' });
        broadcastConversationUpdate(conversation_id);
        return { ok: true, mode: 'agent', conversation_id };
      }
    })
  };
}
