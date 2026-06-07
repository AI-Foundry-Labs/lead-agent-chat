import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { MODEL } from '@/lib/llm';
import {
  getConversation,
  getAgencyConfig,
  getListing,
  getLeadById,
  getVisibleMessages,
  addMessage,
  updateConversation,
  updateLead,
  listActiveHandoffRules
} from '@/lib/db';
import { broadcastConversationUpdate } from '@/lib/events';
import { dispatchReply } from '@/lib/dispatch';
import { notifyAdmins } from '@/lib/notify';
import { matchRule } from '@/lib/agent/rules';
import { buildLeadSystemPrompt, buildAdminSystemPrompt } from '@/lib/agent/prompts';
import {
  buildLeadStewardSystemPrompt,
  buildAnonymousStewardSystemPrompt
} from '@/lib/agent/prompts/steward-prompts';
import { buildCrossThreadContextBlock } from '@/lib/agent/cross-thread-context';
import {
  buildThreadContextMessages,
  scheduleThreadMemorySummarize
} from '@/lib/agent/thread-memory';
import { buildLeadTools } from '@/lib/agent/tools/lead-tools';
import { buildAdminTools } from '@/lib/agent/tools/admin-tools';
import { buildLeadStewardTools } from '@/lib/agent/tools/lead-steward-tools';
import { buildAnonymousStewardTools } from '@/lib/agent/tools/anonymous-steward-tools';
import type { AgentContext } from '@/lib/agent/tools/context';
import type { Conversation, Language } from '@/lib/types';

export type Actor =
  | { type: 'lead' }
  | { type: 'admin'; adminId: string; adminName: string | null }
  | { type: 'lead_steward'; leadId: string; adminId: string; adminName: string | null }
  | { type: 'anonymous_steward'; adminId: string; adminName: string | null };

export type TurnStatus = 'replied' | 'manual' | 'handoff';

export interface TurnResult {
  conversation: Conversation;
  reply: string;
  status: TurnStatus;
}

const MAX_STEPS = 6;

function shouldDispatchReply(conversation: Conversation): boolean {
  if (conversation.type === 'lead') return true;
  if (conversation.type === 'admin_assistant') return true;
  return false;
}

// Build the model transcript from stored messages. From the lead's perspective an
// admin takeover message reads as an assistant turn.
function toModelMessages(
  msgs: { role: string; content: string }[]
): ModelMessage[] {
  return msgs
    .filter((m) => m.role !== 'tool')
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));
}

export async function runAgentTurn(
  conversationId: string,
  message: string,
  actor: Actor,
  lang: Language = 'fr'
): Promise<TurnResult> {
  const conversation = await getConversation(conversationId);
  if (!conversation) throw new Error('conversation_not_found');
  const config = await getAgencyConfig();
  if (!config) throw new Error('Agency config not initialized — run db:seed');

  // Persist the inbound message so every client sees it immediately.
  if (message.trim()) {
    await addMessage({
      conversation_id: conversationId,
      role: 'user',
      content: message
    });
    broadcastConversationUpdate(conversationId);
  }

  // Takeover safety: a lead conversation in manual mode does not auto-reply.
  if (conversation.type === 'lead' && conversation.mode === 'manual') {
    await notifyAdmins(`New lead message (manual mode): ${message.slice(0, 160)}`);
    return { conversation, reply: '', status: 'manual' };
  }

  // Deterministic handoff rules (admin-configured) pre-empt the agent for leads.
  if (conversation.type === 'lead' && message.trim()) {
    const rules = await listActiveHandoffRules();
    const matched = await matchRule(message, rules);
    if (matched) {
      const updated = await updateConversation(conversationId, { mode: 'manual' });
      if (conversation.lead_id)
        await updateLead(conversation.lead_id, { status: 'handoff' });
      const ack =
        "Merci pour votre message. Un conseiller senior va vous répondre personnellement très vite. / Thank you — a senior advisor will follow up with you shortly.";
      await addMessage({ conversation_id: conversationId, role: 'assistant', content: ack });
      await notifyAdmins(`Handoff (rule: ${matched.description}) — "${message.slice(0, 120)}"`);
      broadcastConversationUpdate(conversationId);
      await dispatchReply(updated, ack);
      return { conversation: updated, reply: ack, status: 'handoff' };
    }
  }

  const ctx: AgentContext = { conversation, config };

  let system: string;
  let tools;
  if (actor.type === 'admin') {
    system = buildAdminSystemPrompt({ config, adminName: actor.adminName });
    tools = buildAdminTools(ctx);
  } else if (actor.type === 'lead_steward') {
    const lead = await getLeadById(actor.leadId);
    if (!lead) throw new Error('lead_not_found');
    system = await buildLeadStewardSystemPrompt({
      config,
      lead,
      adminName: actor.adminName,
      lang
    });
    tools = buildLeadStewardTools(ctx, actor.leadId);
  } else if (actor.type === 'anonymous_steward') {
    system = await buildAnonymousStewardSystemPrompt({
      config,
      adminName: actor.adminName,
      lang
    });
    tools = buildAnonymousStewardTools(ctx);
  } else {
    const listing = await getListing(conversation.listing_id);
    const lead = conversation.lead_id
      ? await getLeadById(conversation.lead_id)
      : null;
    const crossThreadContext =
      lead != null
        ? await buildCrossThreadContextBlock({
            leadId: lead.id,
            currentConversationId: conversationId,
            lang
          })
        : '';
    system = buildLeadSystemPrompt({
      config,
      listing,
      lead,
      lang,
      channel: conversation.primary_channel,
      crossThreadContext
    });
    tools = buildLeadTools(ctx);
  }

  const messages =
    actor.type === 'lead'
      ? await buildThreadContextMessages(conversationId)
      : toModelMessages(await getVisibleMessages(conversationId));

  const result = await generateText({
    model: MODEL,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS)
  });

  const toolCalls = result.steps.flatMap((s) => s.toolCalls);
  const toolResults = result.steps.flatMap((s) => s.toolResults);

  await addMessage({
    conversation_id: conversationId,
    role: 'assistant',
    content: result.text,
    tool_calls: toolCalls.length ? toolCalls : null,
    tool_results: toolResults.length ? toolResults : null
  });

  broadcastConversationUpdate(conversationId);
  if (shouldDispatchReply(ctx.conversation)) {
    await dispatchReply(ctx.conversation, result.text);
  }

  if (actor.type === 'lead') {
    scheduleThreadMemorySummarize(conversationId);
  }

  return { conversation: ctx.conversation, reply: result.text, status: 'replied' };
}
