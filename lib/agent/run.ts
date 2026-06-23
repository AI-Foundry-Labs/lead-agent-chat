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
import { matchRule } from '@/lib/agent/rules';
import { reportHandoffBriefing } from '@/lib/agent/report-handoff-briefing';
import { detectMessageLang } from '@/lib/agent/detect-lang';
import { pushAgentNotification } from '@/lib/agent/push-agent-notification';
import { notifyAdmins } from '@/lib/notify';
import { notifyAgencyGroup } from '@/lib/telegram/notify-agency';
import { promoteAnonymousVisitor } from '@/lib/telegram/promote-anonymous-visitor';
import { buildLeadSystemPrompt } from '@/lib/agent/prompts';
import { buildOperatorSystemPrompt } from '@/lib/agent/prompts/operator-prompts';
import { buildCrossThreadContextBlock } from '@/lib/agent/cross-thread-context';
import {
  buildThreadContextMessages,
  scheduleThreadMemorySummarize
} from '@/lib/agent/thread-memory';
import { buildLeadTools } from '@/lib/agent/tools/lead-tools';
import { buildOperatorTools } from '@/lib/agent/tools/operator-tools';
import { buildMainAssistantTools } from '@/lib/agent/tools/main-assistant';
import { buildMainAssistantSystemPrompt } from '@/lib/agent/prompts/main-assistant-prompt';
import { getAdminById } from '@/lib/db/admins';
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

  let conversation = await getConversation(conversationId);
  if (!conversation) {
    agentLog.error('agent.turn.error', { conversationId, error: 'conversation_not_found' });
    throw new Error('conversation_not_found');
  }
  const config = await getAgencyConfig(conversation.agency_id);
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
    // Note: the lead's inbound message is no longer mirrored verbatim here — it is
    // folded into the per-turn report posted after the agent replies (see below).
  }

  // Detect lead's actual message language (runs in background; defaults to 'fr').
  // Used for admin notifications so they receive messages in the lead's language.
  const detectedLang = actor.type === 'lead' && message.trim()
    ? await detectMessageLang(message)
    : lang;

  // Takeover safety: a lead conversation in manual mode does not auto-reply.
  if (conversation.type === 'lead' && conversation.mode === 'manual') {
    agentLog.info('agent.manual_mode', { conversationId, messageLen: message.length });
    if (conversation.lead_id) {
      void pushAgentNotification({
        agencyId: conversation.agency_id,
        leadId: conversation.lead_id,
        event: { kind: 'manual', message: message.slice(0, 300) },
        lang: detectedLang
      });
    }
    return { conversation, reply: '', status: 'manual' };
  }

  // Deterministic handoff rules: notify admins but let the agent keep responding.
  // The agent goes silent only when admin explicitly clicks "Take over".
  if (conversation.type === 'lead' && message.trim()) {
    const rules = await listActiveHandoffRules(conversation.agency_id);
    const matched = await matchRule(message, rules);
    if (matched) {
      let lead = conversation.lead_id ? await getLeadById(conversation.lead_id) : null;
      // Only escalate once — skip if lead is already in handoff status.
      if (!lead || lead.status !== 'handoff') {
        // Anonymous visitor → promote to a real lead first so the admin gets a
        // selectable identity ("Visiteur #N") in /agent instead of an opaque alert.
        if (!conversation.lead_id) {
          const promoted = await promoteAnonymousVisitor(conversation, conversation.agency_id, {
            language: detectedLang
          }).catch((e) => {
            agentLog.warn('agent.handoff.promote.error', { conversationId, error: String(e) });
            return null;
          });
          if (promoted) {
            lead = promoted;
            conversation = await getConversation(conversationId) ?? conversation;
          }
        }
        agentLog.info('agent.handoff', { conversationId, rule: matched.description, leadId: lead?.id ?? null });
        if (lead) await updateLead(lead.id, { status: 'handoff' });
        if (lead) {
          void pushAgentNotification({
            agencyId: conversation.agency_id,
            leadId: lead.id,
            event: { kind: 'handoff', rule: matched.description, message: message.slice(0, 300) },
            lang: detectedLang
          });
        } else {
          // Promotion failed (e.g. lost race) — still alert the Master topic.
          const note = `🚨 Handoff — visiteur anonyme\nRègle : ${matched.description}\nMessage : ${message.slice(0, 200)}`;
          void notifyAgencyGroup(conversation.agency_id, note);
          void notifyAdmins(note);
        }
        // Lead reports up: generate a briefing from this lead's own context and post it
        // into the admin's main_assistant panel (fire-and-forget — no separate operator agent).
        void reportHandoffBriefing({ lead, triggerMessage: message, ruleName: matched.description, lang });
      }
      // Fall through — agent continues responding normally.
    }
  }

  const ctx: AgentContext = { conversation, config, lang: detectedLang };

  let system: string;
  let tools;
  if (actor.type === 'main_assistant') {
    const adminRow = await getAdminById(actor.adminId);
    system = await buildMainAssistantSystemPrompt({
      config,
      adminName: actor.adminName,
      adminPersona: adminRow?.persona ?? null,
    });
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
    // Don't dispatch the generic error fallback to external channels (Telegram) for
    // non-lead conversations — the admin already sees it in the web UI. For lead
    // conversations, always dispatch so the visitor gets a response on every channel.
    const shouldDispatchContent = reply.trim() || ctx.conversation.type === 'lead';
    if (shouldDispatchContent) {
      await dispatchReply(ctx.conversation, storedContent);
    }
  }

  if (actor.type === 'lead') {
    // Single-topic UX: per-lead topics are gone, so we no longer mirror every
    // lead↔agent turn into Telegram (handoff/alerts go to the 🛠 Master topic via
    // notifyAgency). Keep rolling thread-memory summaries for agent context.
    scheduleThreadMemorySummarize(conversationId);
  }

  return { conversation: ctx.conversation, reply: storedContent, status: 'replied' };
}
