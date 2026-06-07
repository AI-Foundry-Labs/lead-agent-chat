import { tool, generateText } from 'ai';
import { z } from 'zod';
import {
  getConversation,
  getLeadById,
  getVisibleMessages,
  addMessage,
  updateConversation,
  listAnonymousVisitorThreads
} from '@/lib/db';
import { isIdentifiedLead } from '@/lib/leads/is-identified-lead';
import { MODEL } from '@/lib/llm';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import type { AgentContext } from './context';

async function assertAnonymousThread(conversationId: string) {
  const conv = await getConversation(conversationId);
  if (!conv || conv.type !== 'lead') return null;
  if (!conv.lead_id) return conv;
  const lead = await getLeadById(conv.lead_id);
  if (lead && isIdentifiedLead(lead)) return null;
  return conv;
}

export function buildAnonymousStewardTools(ctx: AgentContext) {
  return {
    list_anonymous_threads: tool({
      description: 'List all visitor threads for unidentified / anonymous visitors.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      execute: async ({ limit }) => {
        const threads = await listAnonymousVisitorThreads();
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
      description: 'Read full messages for one anonymous visitor thread.',
      inputSchema: z.object({ conversation_id: z.string().uuid() }),
      execute: async ({ conversation_id }) => {
        const conv = await assertAnonymousThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_identified' };
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
      description: 'Draft a reply for an anonymous thread (saved, not sent).',
      inputSchema: z.object({
        conversation_id: z.string().uuid(),
        intent: z.string().max(400)
      }),
      execute: async ({ conversation_id, intent }) => {
        const conv = await assertAnonymousThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_identified' };
        const history = await getVisibleMessages(conversation_id);
        const transcript = history
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n');
        const { text } = await generateText({
          model: MODEL,
          prompt: `Draft a reply for an anonymous real-estate visitor at ${ctx.config.name}.
Intent: ${intent}
Tone: ${ctx.config.tone}

THREAD:
${transcript}

Write only the reply text.`
        });
        await addMessage({
          conversation_id,
          role: 'assistant',
          content: text,
          is_draft: true
        });
        broadcastConversationUpdate(conversation_id);
        return { ok: true, draft: text };
      }
    }),

    send_reply: tool({
      description: 'Send a message on an anonymous visitor thread.',
      inputSchema: z.object({
        conversation_id: z.string().uuid(),
        content: z.string().min(1)
      }),
      execute: async ({ conversation_id, content }) => {
        const conv = await assertAnonymousThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_identified' };
        await addMessage({ conversation_id, role: 'admin', content });
        await dispatchReply(conv, content);
        broadcastConversationUpdate(conversation_id);
        return { ok: true, sent: true, conversation_id };
      }
    }),

    takeover_thread: tool({
      description: 'Manual mode for an anonymous thread.',
      inputSchema: z.object({ conversation_id: z.string().uuid() }),
      execute: async ({ conversation_id }) => {
        const conv = await assertAnonymousThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_identified' };
        await updateConversation(conversation_id, { mode: 'manual' });
        broadcastConversationUpdate(conversation_id);
        return { ok: true, mode: 'manual' };
      }
    }),

    release_thread: tool({
      description: 'Return an anonymous thread to AI mode.',
      inputSchema: z.object({ conversation_id: z.string().uuid() }),
      execute: async ({ conversation_id }) => {
        const conv = await assertAnonymousThread(conversation_id);
        if (!conv) return { error: 'thread_not_found_or_identified' };
        await updateConversation(conversation_id, { mode: 'agent' });
        broadcastConversationUpdate(conversation_id);
        return { ok: true, mode: 'agent' };
      }
    })
  };
}
