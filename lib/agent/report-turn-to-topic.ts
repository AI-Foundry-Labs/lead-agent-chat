/**
 * Report-style turn relay (replaces the verbatim conversation mirror).
 *
 * Instead of copying the agent's customer-facing reply 1:1 into the agency's
 * Telegram conversation topic, the lead's own agent produces a short "report to
 * the boss" — what the prospect asked and what the agent did about it — so staff
 * read internal-styled updates rather than the literal text sent to the visitor.
 *
 * Never throws: a failure here must not break the main agent turn.
 */
import { generateText } from 'ai';
import { FAST_MODEL } from '@/lib/llm';
import { getLeadById } from '@/lib/db';
import { getLeadTopicsByLead } from '@/lib/db/lead-telegram-topics';
import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { agentLog } from '@/lib/logger';
import type { Conversation, Language } from '@/lib/types';

// Bilingual report prefix shown in the topic.
const PREFIX: Record<Language, string> = {
  fr: '📋 Compte-rendu',
  en: '📋 Report'
};

function buildSystemPrompt(lang: Language): string {
  if (lang === 'en') {
    return (
      `You are the AI agent dedicated to this prospect, reporting to your manager. ` +
      `Write a SHORT internal report (not a message to the prospect) covering: ` +
      `(1) what the prospect asked or did, (2) how you handled it / what you replied, ` +
      `(3) any action the human team should be aware of. ` +
      `Write in the third person about the prospect. Be concise — 1-3 short lines, no greetings.`
    );
  }
  return (
    `Tu es l'agent IA dédié à ce prospect et tu fais un compte-rendu à ton responsable. ` +
    `Rédige un compte-rendu interne COURT (ce n'est pas un message au prospect) qui couvre : ` +
    `(1) ce que le prospect a demandé ou fait, (2) comment tu l'as traité / ta réponse, ` +
    `(3) toute action que l'équipe humaine devrait connaître. ` +
    `Parle du prospect à la troisième personne. Sois concis — 1 à 3 lignes courtes, sans formule de politesse.`
  );
}

/**
 * Generate a report-style summary of one lead↔agent turn and post it into the
 * agency supergroup's conversation topic. Replaces mirrorLeadTurnToTopic for the
 * agent side; lead-side turns are folded into this single per-turn report.
 */
export async function reportTurnToTopic(args: {
  conversation: Conversation;
  leadMessage: string;
  agentReply: string;
  lang: Language;
}): Promise<void> {
  const { conversation, leadMessage, agentReply, lang } = args;
  if (conversation.type !== 'lead' || !conversation.lead_id) return;
  if (!agentReply.trim() && !leadMessage.trim()) return;

  try {
    const topics = await getLeadTopicsByLead(
      conversation.agency_id,
      conversation.lead_id
    );
    if (!topics?.group_chat_id || !topics.conversation_topic_id) return;

    const lead = await getLeadById(conversation.lead_id);
    const who = lead?.name?.trim() || '(prospect anonyme)';

    let report: string;
    try {
      const { text } = await generateText({
        model: FAST_MODEL,
        system: buildSystemPrompt(lang),
        prompt:
          `Prospect : ${who}\n\n` +
          `Message du prospect :\n« ${leadMessage.slice(0, 600) || '(aucun)'} »\n\n` +
          `Réponse de l'agent IA :\n« ${agentReply.slice(0, 600) || '(aucune)'} »`
      });
      report = text.trim();
    } catch (e) {
      agentLog.warn('agent.report.gen.error', {
        conversationId: conversation.id,
        error: String(e)
      });
      // Fallback: minimal third-person note so the topic still gets an update.
      report =
        lang === 'en'
          ? `${who} sent a message; the agent replied. (Auto-report unavailable.)`
          : `${who} a envoyé un message ; l'agent a répondu. (Compte-rendu auto indisponible.)`;
    }

    if (!report) return;
    const prefix = PREFIX[lang] ?? PREFIX.fr;
    void enqueueGroupSend(topics.group_chat_id, `${prefix}: ${report}`, {
      threadId: topics.conversation_topic_id,
      kind: 'mirror'
    });
  } catch (e) {
    agentLog.warn('agent.report.error', {
      conversationId: conversation.id,
      error: String(e)
    });
  }
}
