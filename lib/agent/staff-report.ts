/**
 * Agentic staff notifications.
 *
 * Replaces the fixed template strings (notification-strings.ts) for events the
 * AI agent reports to the human team — handoff, manual-mode messages, bookings,
 * handoff requests. The agent writes a short "report to the boss" (third person,
 * concise) instead of a canned template.
 *
 * notification-strings.ts is KEPT as a deterministic fallback: if the LLM call
 * fails, the original template is returned so a notification is never lost.
 */
import { generateText } from 'ai';
import { FAST_MODEL } from '@/lib/llm';
import { notif } from '@/lib/agent/notification-strings';
import { agentLog } from '@/lib/logger';
import type { Language } from '@/lib/types';

export type StaffEvent =
  | { kind: 'handoff'; rule: string; message: string }
  | { kind: 'manual'; message: string }
  | { kind: 'viewing_booked'; title: string; slot: string; contact: string }
  | { kind: 'handoff_requested'; reason: string; leadName?: string | null };

// Leading marker per event so the channel still reads at a glance.
export const STAFF_MARKER: Record<StaffEvent['kind'], string> = {
  handoff: '🚨',
  manual: '📩',
  viewing_booked: '📅',
  handoff_requested: '🤝'
};

function systemPrompt(lang: Language): string {
  if (lang === 'en') {
    return (
      `You are the AI agent dedicated to this prospect, reporting to your human manager. ` +
      `Write a SHORT internal report (NOT a message to the prospect), in the third person about the prospect. ` +
      `State what happened and, if relevant, the action the team should take. ` +
      `1-3 short lines, no greeting, no sign-off. Do not invent facts beyond what is given.`
    );
  }
  return (
    `Tu es l'agent IA dédié à ce prospect et tu fais un compte-rendu à ton responsable humain. ` +
    `Rédige un compte-rendu interne COURT (ce n'est PAS un message au prospect), à la troisième personne sur le prospect. ` +
    `Indique ce qui s'est passé et, le cas échéant, l'action que l'équipe doit mener. ` +
    `1 à 3 lignes courtes, sans salutation ni formule de politesse. N'invente aucune information.`
  );
}

function userPrompt(event: StaffEvent, lang: Language): string {
  const fr = lang !== 'en';
  switch (event.kind) {
    case 'handoff':
      return fr
        ? `Transfert automatique déclenché par la règle « ${event.rule} ».\nDernier message du prospect : « ${event.message.slice(0, 400)} ».`
        : `Automatic handoff triggered by rule "${event.rule}".\nProspect's last message: "${event.message.slice(0, 400)}".`;
    case 'manual':
      return fr
        ? `Le bot est en mode conseiller (en pause). Le prospect vient d'écrire : « ${event.message.slice(0, 400)} ». Le conseiller doit répondre.`
        : `The bot is in advisor mode (paused). The prospect just wrote: "${event.message.slice(0, 400)}". The advisor must reply.`;
    case 'viewing_booked':
      return fr
        ? `Visite confirmée.\nBien : ${event.title}\nQuand : ${event.slot}\nContact : ${event.contact}`
        : `Viewing confirmed.\nProperty: ${event.title}\nWhen: ${event.slot}\nContact: ${event.contact}`;
    case 'handoff_requested':
      return fr
        ? `Transfert demandé pour le prospect ${event.leadName ?? '(inconnu)'}.\nRaison : ${event.reason}`
        : `Handoff requested for prospect ${event.leadName ?? '(unknown)'}.\nReason: ${event.reason}`;
  }
}

/**
 * Deterministic template fallback for an event. Exported for tests and reused on
 * any LLM failure so a staff notification is never lost or empty.
 */
export function staffReportFallback(event: StaffEvent, lang: Language): string {
  const n = notif(lang);
  switch (event.kind) {
    case 'handoff':
      return n.handoff(event.rule, event.message);
    case 'manual':
      return n.manual(event.message);
    case 'viewing_booked':
      return n.viewing_booked_chat(event.title, event.slot, event.contact);
    case 'handoff_requested':
      return n.handoff_requested(event.reason);
  }
}

/**
 * Generate an agentic, report-style staff notification for an event.
 * Never throws — falls back to the deterministic template on any LLM error.
 */
export async function generateStaffReport(
  event: StaffEvent,
  lang: Language
): Promise<string> {
  try {
    const { text } = await generateText({
      model: FAST_MODEL,
      system: systemPrompt(lang),
      prompt: userPrompt(event, lang)
    });
    const body = text.trim();
    if (!body) return staffReportFallback(event, lang);
    return `${STAFF_MARKER[event.kind]} ${body}`;
  } catch (e) {
    agentLog.warn('agent.staff_report.error', { kind: event.kind, error: String(e) });
    return staffReportFallback(event, lang);
  }
}
