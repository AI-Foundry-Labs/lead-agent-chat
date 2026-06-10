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
  listActiveHandoffRules,
  getOrCreateLeadSteward
} from '@/lib/db';
import { db, admins } from '@/lib/db/client';
import { broadcastConversationUpdate } from '@/lib/events';
import { dispatchReply } from '@/lib/dispatch';
import { notifyAdmins, notifyAdminsInChat } from '@/lib/notify';
import { matchRule } from '@/lib/agent/rules';
import { buildLeadSystemPrompt } from '@/lib/agent/prompts';
import { buildStewardSystemPrompt } from '@/lib/agent/prompts/steward-prompts';
import { buildCrossThreadContextBlock } from '@/lib/agent/cross-thread-context';
import {
  buildThreadContextMessages,
  scheduleThreadMemorySummarize
} from '@/lib/agent/thread-memory';
import { buildLeadTools } from '@/lib/agent/tools/lead-tools';
import { buildStewardTools } from '@/lib/agent/tools/steward-tools';
import { buildMainAssistantTools } from '@/lib/agent/tools/main-assistant-tools';
import { buildMainAssistantSystemPrompt } from '@/lib/agent/prompts/main-assistant-prompt';
import type { AgentContext } from '@/lib/agent/tools/context';
import type { Conversation, Language } from '@/lib/types';

export type Actor =
  | { type: 'lead' }
  | { type: 'steward'; leadId: string | null; adminId: string; adminName: string | null }
  | { type: 'main_assistant'; adminId: string; adminName: string | null };

export type TurnStatus = 'replied' | 'manual' | 'handoff';

export interface TurnResult {
  conversation: Conversation;
  reply: string;
  status: TurnStatus;
}

const MAX_STEPS = 6;

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
    .filter((m) => m.role !== 'tool')
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
  const conversation = await getConversation(conversationId);
  if (!conversation) throw new Error('conversation_not_found');
  const config = await getAgencyConfig();
  if (!config) throw new Error('Agency config not initialized — run db:seed');

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
        if (conversation.lead_id)
          await updateLead(conversation.lead_id, { status: 'handoff' });
        await notifyAdmins(`[Handoff] Rule triggered: "${matched.description}" — "${message.slice(0, 120)}"`);
        await notifyAdminsInChat(`🚨 Intervention conseiller requise\n\nRègle déclenchée : « ${matched.description} »\n\nLe prospect vient d'envoyer :\n« ${message.slice(0, 300)} »\n\nVeuillez consulter l'onglet Agents pour le briefing complet et prendre en charge la conversation si nécessaire.`);
        // Fire-and-forget: steward agent generates a full natural-language briefing
        // for the admin in the Agents tab, with complete lead context.
        if (conversation.lead_id) {
          const leadId = conversation.lead_id;
          const triggerMsg = message;
          const ruleName = matched.description;
          ;(async () => {
            try {
              const [adminRow] = await db
                .select({ id: admins.id, name: admins.name })
                .from(admins)
                .limit(1);
              if (!adminRow) return;
              const stewardConv = await getOrCreateLeadSteward(leadId);
              await runAgentTurn(
                stewardConv.id,
                `🚨 Alerte de transfert — intervention conseiller requise\n\n` +
                `La règle d'escalade suivante vient d'être déclenchée : « ${ruleName} ».\n\n` +
                `Le prospect vient d'envoyer le message suivant :\n« ${triggerMsg.slice(0, 400)} »\n\n` +
                `Merci de consulter le profil complet de ce prospect ainsi que l'historique de ses échanges, ` +
                `puis : (1) réévaluez le potentiel (hot/warm/cold) et le statut du prospect via update_lead_status ` +
                `si l'échange révèle un changement d'intention, (2) consignez les faits durables via remember_visitor_fact, ` +
                `(3) fournissez-moi un briefing détaillé : qui est ce client, quels sont ses besoins, ` +
                `pourquoi cette situation nécessite-t-elle l'intervention d'un conseiller humain, ` +
                `et quelle est la prochaine action recommandée ?`,
                { type: 'steward', leadId, adminId: adminRow.id, adminName: adminRow.name },
                'fr',
                'system'
              );
            } catch (e) {
              console.error('[handoff] steward briefing failed:', e);
            }
          })();
        }
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
  } else if (actor.type === 'steward') {
    const lead = actor.leadId ? await getLeadById(actor.leadId) : null;
    if (actor.leadId && !lead) throw new Error('lead_not_found');
    system = await buildStewardSystemPrompt({
      config,
      lead,
      adminName: actor.adminName,
      lang
    });
    tools = buildStewardTools(ctx, actor.leadId);
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
