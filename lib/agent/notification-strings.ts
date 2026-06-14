// FR-only version — all notifications in French regardless of lead language
const strings = {
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
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function notif(_lang?: unknown) {
  return strings;
}
