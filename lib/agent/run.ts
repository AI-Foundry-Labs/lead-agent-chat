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
import { notifyAdmins, notifyAdminsInChat } from '@/lib/notify';
import { matchRule } from '@/lib/agent/rules';
import { reportHandoffBriefing } from '@/lib/agent/report-handoff-briefing';
import { buildLeadSystemPrompt } from '@/lib/agent/prompts';
import { buildOperatorSystemPrompt } from '@/lib/agent/prompts/operator-prompts';
import { buildCrossThreadContextBlock } from '@/lib/agent/cross-thread-context';
import {
  buildThreadContextMessages,
  scheduleThreadMemorySummarize
} from '@/lib/agent/thread-memory';
import { buildLeadTools } from '@/lib/agent/tools/lead-tools';
import { buildOperatorTools } from '@/lib/agent/tools/operator-tools';
import { buildMainAssistantTools } from '@/lib/agent/tools/main-assistant-tools';
import { buildMainAssistantSystemPrompt } from '@/lib/agent/prompts/main-assistant-prompt';
import type { AgentContext } from '@/lib/agent/tools/context';
import type { Conversation, Language } from '@/lib/types';
import { agentLog } from '@/lib/logger';

export type Actor =
  | { type: 'lead' }
  | { type: 'operator'; leadId: string | null; adminId: string; adminName: string | null }
  | { type: 'main_assistant'; adminId: string; adminName: string | null };

export type TurnStatus = 'replied' | 'manual' | 'handoff';

export interface TurnResult {
  conversation: Conversation;
  reply: string;
  status: TurnStatus;
}

const MAX_STEPS = 10;

function shouldDispatchReply(conversation: Conversation): boolean {
  if (conversation.type === 'lead') return true;
  if (conversation.type === 'main_assistant') return true;
  return false;
}

// Build the model transcript from stored messages. From the lead's perspective an
// admin takeover message reads as an assistant turn.
function toModelMessages(
  msgs: { role: string; content: string }[]
): ModelMessage[] {
  return msgs
    .filter((m) => m.role !== 'tool' && m.content.trim() !== '')
    .map((m) => ({
      // 'system' role = auto-injected prompt (handoff alerts etc.) → treat as user turn for LLM
      role: (m.role === 'user' || m.role === 'system') ? 'user' : 'assistant',
      content: m.content
    }));
}

export async function runAgentTurn(
  conversationId: string,
  message: string,
  actor: Actor,
  lang: Language = 'fr',
  messageRole: 'user' | 'system' = 'user'
): Promise<TurnResult> {
  const turnStart = Date.now();
  agentLog.info('agent.turn.start', { conversationId, actor: actor.type, messageLen: message.length, lang });

  const conversation = await getConversation(conversationId);
  if (!conversation) {
    agentLog.error('agent.turn.error', { conversationId, error: 'conversation_not_found' });
    throw new Error('conversation_not_found');
  }
  const config = await getAgencyConfig();
  if (!config) {
    agentLog.error('agent.turn.error', { conversationId, error: 'agency_config_missing' });
    throw new Error('Agency config not initialized — run db:seed');
  }

  // Persist the inbound message so every client sees it immediately.
  if (message.trim()) {
    await addMessage({
      conversation_id: conversationId,
      role: messageRole,
      content: message
    });
    broadcastConversationUpdate(conversationId);
  }

  // Takeover safety: a lead conversation in manual mode does not auto-reply.
  if (conversation.type === 'lead' && conversation.mode === 'manual') {
    agentLog.info('agent.manual_mode', { conversationId, messageLen: message.length });
    await notifyAdmins(`[Advisor mode] New message from lead: "${message.slice(0, 160)}"`);
    await notifyAdminsInChat(`📩 Nouveau message client — mode conseiller\n\nLe prospect vous a envoyé :\n« ${message.slice(0, 300)} »\n\nVous pouvez répondre directement depuis l'interface web.`);
    return { conversation, reply: '', status: 'manual' };
  }

  // Deterministic handoff rules: notify admins but let the agent keep responding.
  // The agent goes silent only when admin explicitly clicks "Take over".
  if (conversation.type === 'lead' && message.trim()) {
    const rules = await listActiveHandoffRules();
    const matched = await matchRule(message, rules);
    if (matched) {
      const lead = conversation.lead_id ? await getLeadById(conversation.lead_id) : null;
      // Only escalate once — skip if lead is already in handoff status.
      if (!lead || lead.status !== 'handoff') {
        agentLog.info('agent.handoff', { conversationId, rule: matched.description, leadId: conversation.lead_id });
        if (conversation.lead_id)
          await updateLead(conversation.lead_id, { status: 'handoff' });
        await notifyAdmins(`[Handoff] Rule triggered: "${matched.description}" — "${message.slice(0, 120)}"`);
        // Lead reports up: generate a briefing from this lead's own context and post it
        // into the admin's main_assistant panel (fire-and-forget — no separate operator agent).
        const triggerMsg = message;
        const ruleName = matched.description;
        void reportHandoffBriefing({ lead, triggerMessage: triggerMsg, ruleName, lang });
      }
      // Fall through — agent continues responding normally.
    }
  }

  const ctx: AgentContext = { conversation, config };

  let system: string;
  let tools;
  if (actor.type === 'main_assistant') {
    system = await buildMainAssistantSystemPrompt({ config, adminName: actor.adminName });
    tools = buildMainAssistantTools(ctx, actor.adminId, actor.adminName, runAgentTurn as Parameters<typeof buildMainAssistantTools>[3]);
  } else if (actor.type === 'operator') {
    const lead = actor.leadId ? await getLeadById(actor.leadId) : null;
    if (actor.leadId && !lead) throw new Error('lead_not_found');
    system = await buildOperatorSystemPrompt({
      config,
      lead,
      adminName: actor.adminName,
      lang
    });
    tools = buildOperatorTools(ctx, actor.leadId);
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
  const latencyMs = Date.now() - turnStart;

  // Log each tool call for audit trail
  for (const tc of toolCalls) {
    agentLog.info('agent.tool.call', { conversationId, tool: tc.toolName });
  }

  const reply: string = result.text;

  if (!reply.trim()) {
    agentLog.warn('agent.empty_reply', {
      conversationId,
      steps: result.steps.length,
      finishReason: result.finishReason,
      toolCallCount: toolCalls.length,
      latencyMs
    });
  }

  agentLog.info('agent.turn.end', {
    conversationId,
    actor: actor.type,
    steps: result.steps.length,
    finishReason: result.finishReason,
    toolCallCount: toolCalls.length,
    replyLen: reply.length,
    latencyMs
  });

  // Never persist empty assistant messages — they corrupt future context
  // and cause the model to mirror the empty pattern on the next turn.
  const storedContent = reply.trim()
    ? reply
    : lang === 'en'
      ? "I'm sorry, I encountered an issue. Could you please repeat your message?"
      : "Je suis désolé, une erreur est survenue. Pourriez-vous répéter votre message ?";

  await addMessage({
    conversation_id: conversationId,
    role: 'assistant',
    content: storedContent,
    tool_calls: toolCalls.length ? toolCalls : null,
    tool_results: toolResults.length ? toolResults : null
  });

  broadcastConversationUpdate(conversationId);
  if (shouldDispatchReply(ctx.conversation)) {
    await dispatchReply(ctx.conversation, storedContent);
  }

  if (actor.type === 'lead') {
    scheduleThreadMemorySummarize(conversationId);
  }

  return { conversation: ctx.conversation, reply: storedContent, status: 'replied' };
}
