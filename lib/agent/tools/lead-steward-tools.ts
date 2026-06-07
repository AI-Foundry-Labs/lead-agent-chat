import { tool, generateText } from 'ai';
import { z } from 'zod';
import {
  getVisibleMessages,
  addMessage,
  updateConversation,
  listConversationsByLeadId,
  getConversationByIdForLead
} from '@/lib/db';
import { MODEL } from '@/lib/llm';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import type { AgentContext } from './context';

function threadTools(ctx: AgentContext, leadId: string) {
  const assertThread = async (conversationId: string) => {
    return getConversationByIdForLead(conversationId, leadId);
  };

  return {
    list_threads: tool({
      description: 'List all visitor-facing threads for this lead.',
      inputSchema: z.object({}),
      execute: async () => {
        const threads = await listConversationsByLeadId(leadId);
        return threads.map((t) => ({
          conversation_id: t.id,
          channel: t.primary_channel,
          listing_id: t.listing_id,
          mode: t.mode,
          thread_summary: t.thread_summary,
          updated_at: t.updated_at
        }));
      }
    }),

    get_thread: tool({
      description: 'Read full messages for one visitor thread of this lead.',
      inputSchema: z.object({ conversation_id: z.string().uuid() }),
      execute: async ({ conversation_id }) => {
        const conv = await assertThread(conversation_id);
        if (!conv) return { error: 'thread_not_found' };
        const messages = await getVisibleMessages(conversation_id);
        return {
          conversation_id,
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
        if (!conv) return { error: 'thread_not_found' };
        const history = await getVisibleMessages(conversation_id);
        const transcript = history
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n');
        const { text } = await generateText({
          model: MODEL,
          prompt: `Draft a reply for this real-estate visitor thread at ${ctx.config.name}.
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
      description: 'Send a message to the visitor on their thread channel.',
      inputSchema: z.object({
        conversation_id: z.string().uuid(),
        content: z.string().min(1)
      }),
      execute: async ({ conversation_id, content }) => {
        const conv = await assertThread(conversation_id);
        if (!conv) return { error: 'thread_not_found' };
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
        if (!conv) return { error: 'thread_not_found' };
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
        if (!conv) return { error: 'thread_not_found' };
        await updateConversation(conversation_id, { mode: 'agent' });
        broadcastConversationUpdate(conversation_id);
        return { ok: true, mode: 'agent', conversation_id };
      }
    })
  };
}

export function buildLeadStewardTools(ctx: AgentContext, leadId: string) {
  return threadTools(ctx, leadId);
}
