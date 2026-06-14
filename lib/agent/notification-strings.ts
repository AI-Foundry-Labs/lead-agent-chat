import type { Language } from '@/lib/types';

const strings = {
  fr: {
    manual: (msg: string) =>
      `📩 Nouveau message client — mode conseiller\n\n« ${msg} »\n\nRépondez depuis l'interface web ou Topic 1.`,
    handoff: (rule: string, msg: string) =>
      `🚨 Transfert automatique\n\nRègle déclenchée : « ${rule} »\n\nMessage : « ${msg} »\n\nLe prospect attend une réponse humaine.`,
    viewing_booked_label: (title: string, slot: string, contact: string) =>
      `[Visite confirmée] ${title} — ${slot} — ${contact}`,
    viewing_booked_chat: (title: string, slot: string, contact: string) =>
      `📅 Nouvelle visite confirmée\n\n**Bien :** ${title}\n**Quand :** ${slot}\n**Contact :** ${contact}`,
    handoff_requested: (reason: string) =>
      `[Transfert demandé] ${reason}`,
  },
  en: {
    manual: (msg: string) =>
      `📩 New lead message — advisor mode\n\n« ${msg} »\n\nReply from the web UI or Topic 1.`,
    handoff: (rule: string, msg: string) =>
      `🚨 Automatic handoff\n\nRule triggered: « ${rule} »\n\nMessage: « ${msg} »\n\nThe lead is waiting for a human reply.`,
    viewing_booked_label: (title: string, slot: string, contact: string) =>
      `[Viewing booked] ${title} — ${slot} — ${contact}`,
    viewing_booked_chat: (title: string, slot: string, contact: string) =>
      `📅 New viewing confirmed\n\n**Property:** ${title}\n**When:** ${slot}\n**Contact:** ${contact}`,
    handoff_requested: (reason: string) =>
      `[Handoff requested] ${reason}`,
  },
} as const;

export function notif(lang: Language) {
  return strings[lang] ?? strings.fr;
}
