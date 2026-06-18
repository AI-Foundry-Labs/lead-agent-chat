import { tool } from 'ai';
import { z } from 'zod';
import { ilike, eq } from 'drizzle-orm';
import { scheduleAppendLeadLongTermFacts } from '@/lib/agent/append-lead-long-term-facts';
import {
  getConversationByLeadId,
  getVisibleMessages,
  addMessage,
  updateConversation,
  getLatestDraft,
  promoteDraftToSent,
  db,
  messages,
  conversations
} from '@/lib/db';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import type { AgentContext } from '@/lib/agent/tools/context';
import type { RunAgentTurn } from './types';

export function buildMessagingTools(
  ctx: AgentContext,
  adminId: string,
  adminName: string | null,
  runAgentTurn: RunAgentTurn
) {
  return {
    search_messages: tool({
      description: 'Search for a keyword across all conversation messages. Returns matching messages with lead/conversation context.',
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(30).optional()
      }),
      execute: async ({ query, limit }) => {
        const q = `%${query}%`;
        const rows = await db
          .select({
            message_id: messages.id,
            conversation_id: messages.conversation_id,
            role: messages.role,
            content: messages.content,
            timestamp: messages.timestamp,
            lead_id: conversations.lead_id
          })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversation_id, conversations.id))
          .where(ilike(messages.content, q))
          .orderBy(messages.timestamp)
          .limit(limit ?? 15);
        return rows.map((r) => ({
          conversation_id: r.conversation_id,
          lead_id: r.lead_id,
          role: r.role,
          excerpt: r.content.slice(0, 300),
          timestamp: r.timestamp
        }));
      }
    }),

    get_conversation_messages: tool({
      description: 'Fetch recent visible messages from any conversation thread by ID.',
      inputSchema: z.object({
        conversation_id: z.string(),
        limit: z.number().int().min(1).max(100).optional().describe('Max messages to return (default 30)')
      }),
      execute: async ({ conversation_id, limit }) => {
        const msgs = await getVisibleMessages(conversation_id);
        return msgs.slice(-(limit ?? 30)).map((m) => ({ role: m.role, content: m.content }));
      }
    }),

    send_reply: tool({
      description:
        'Directly send a message FROM the admin TO a lead on their active channel. ' +
        'Use this whenever admin wants to write a specific message to a lead — it is saved as an admin message and dispatched immediately. ' +
        'Use memory_note to record significant events into the lead long-term memory. ' +
        'Do NOT use trigger_lead_turn for this purpose.',
      inputSchema: z.object({
        lead_id: z.string(),
        content: z.string().min(1),
        memory_note: z.string().max(600).optional().describe(
          'Optional: a brief note about WHY this message was sent — stored in lead long-term memory.'
        )
      }),
      execute: async ({ lead_id, content, memory_note }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await addMessage({ conversation_id: conv.id, role: 'admin', content });
        await dispatchReply(conv, content);
        broadcastConversationUpdate(conv.id);
        if (memory_note) {
          const date = new Date().toISOString().slice(0, 10);
          scheduleAppendLeadLongTermFacts(lead_id, [`ADMIN ACTION — ${date}: ${memory_note}`]);
        }
        return { ok: true, sent: true };
      }
    }),

    draft_reply: tool({
      description: 'Save a draft message to a lead (not sent). Returns the draft text for review.',
      inputSchema: z.object({ lead_id: z.string(), content: z.string().min(1) }),
      execute: async ({ lead_id, content }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await addMessage({ conversation_id: conv.id, role: 'assistant', content, is_draft: true });
        broadcastConversationUpdate(conv.id);
        return { ok: true, draft: content };
      }
    }),

    promote_draft: tool({
      description: 'Promote the latest draft for a lead to sent — dispatches it to the lead immediately. Optionally override the content.',
      inputSchema: z.object({
        lead_id: z.string(),
        content: z.string().min(1).optional().describe('Override draft content before sending')
      }),
      execute: async ({ lead_id, content }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        const draft = await getLatestDraft(conv.id);
        if (!draft) return { error: 'no_draft' };
        await promoteDraftToSent(draft.id, content);
        await dispatchReply(conv, content ?? draft.content);
        broadcastConversationUpdate(conv.id);
        return { ok: true, sent: true };
      }
    }),

    get_draft: tool({
      description: "Fetch the latest saved draft for a lead's conversation, or null if none exists.",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { draft: null };
        const draft = await getLatestDraft(conv.id);
        return { draft: draft ? { id: draft.id, content: draft.content } : null };
      }
    }),

    take_over: tool({
      description: "Switch a lead's conversation to manual mode — agent stops auto-replying.",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await updateConversation(conv.id, { mode: 'manual' });
        broadcastConversationUpdate(conv.id);
        return { ok: true, mode: 'manual' };
      }
    }),

    release_conversation: tool({
      description: 'Return a lead conversation to agent mode (auto-reply resumes).',
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await updateConversation(conv.id, { mode: 'agent' });
        broadcastConversationUpdate(conv.id);
        return { ok: true, mode: 'agent' };
      }
    }),

    trigger_lead_turn: tool({
      description:
        'Make the lead AI agent autonomously generate and send a response in a conversation. ' +
        'The injected message is an INTERNAL instruction to the bot — it is NOT sent to the lead and does NOT appear as a user message. ' +
        'Use ONLY when you want the bot to decide what to say on its own (e.g. re-engage, follow up). ' +
        'To send a specific message you wrote yourself, use send_reply instead.',
      inputSchema: z.object({
        conversation_id: z.string(),
        message: z.string().min(1).max(1000).describe('Internal instruction for the lead agent — not visible to the lead')
      }),
      execute: async ({ conversation_id, message }) => {
        const recentMsgs = await getVisibleMessages(conversation_id);
        const lastUserMsg = [...recentMsgs].reverse().find((m) => m.role === 'user');
        const detectedLang = lastUserMsg && /[a-zA-Z]/.test(lastUserMsg.content)
          && !/[àâçéèêëîïôùûüÿœæ]/i.test(lastUserMsg.content)
          ? 'en' : 'fr';
        const result = await runAgentTurn(conversation_id, message, { type: 'lead' }, detectedLang, 'system');
        return { ok: true, reply: result.reply };
      }
    })
  };
}
