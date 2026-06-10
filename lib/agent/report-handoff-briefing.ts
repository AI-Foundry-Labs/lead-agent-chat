/**
 * "Lead reports up": when a handoff rule fires, the lead's own agent produces a
 * concise briefing for the admin and posts it into the main_assistant panel.
 * Replaces the former fire-and-forget operator agent (redundant background work).
 */
import { generateText } from 'ai';
import { FAST_MODEL } from '@/lib/llm';
import { notifyAdminsInChat } from '@/lib/notify';
import type { Lead } from '@/lib/types';

export async function reportHandoffBriefing(args: {
  lead: Lead | null;
  triggerMessage: string;
  ruleName: string;
  lang?: string;
}): Promise<void> {
  const { lead, triggerMessage, ruleName } = args;

  const profile = lead
    ? `name: ${lead.name ?? '—'}, email: ${lead.email ?? '—'}, status: ${lead.status}, ` +
      `potential: ${lead.potential_status ?? 'unscored'}\nqualification: ${JSON.stringify(lead.qual_values)}\n` +
      `long-term memory:\n${lead.long_term_memory?.trim() || '(empty)'}`
    : '(anonymous visitor — no lead profile yet)';

  let briefing: string;
  try {
    const { text } = await generateText({
      model: FAST_MODEL,
      system:
        `Tu es l'agent IA dédié à ce prospect. Tu fais remonter un briefing au conseiller humain ` +
        `(il s'affiche dans son panneau Assistant). Sois concret et complet : ` +
        `(1) qui est ce prospect, (2) ses besoins/contexte, (3) pourquoi une intervention humaine est requise, ` +
        `(4) l'action recommandée. Si une information clé manque, dis-le explicitement. ` +
        `Réponds en français, concis, en puces courtes.`,
      prompt: `Règle d'escalade déclenchée : « ${ruleName} »\n\nDernier message du prospect :\n« ${triggerMessage.slice(0, 500)} »\n\nProfil du prospect :\n${profile}`
    });
    briefing = text;
  } catch (e) {
    console.error('[handoff] briefing generation failed:', e);
    briefing = `Règle « ${ruleName} » déclenchée. Message : « ${triggerMessage.slice(0, 300)} ». ` +
      `(Briefing automatique indisponible — veuillez consulter le prospect.)`;
  }

  await notifyAdminsInChat(`🚨 Intervention conseiller requise — règle « ${ruleName} »\n\n${briefing}`);
}
