// Notification = operator-composed report, sent to the Master topic and
// persisted to BOTH the operator↔admin and main-assistant↔admin histories.

export type NotificationTarget = { conversation_id: string; role: 'assistant'; content: string };

/** Pure: the conversation rows that must receive this notification. */
export function buildNotificationTargets(
  operatorConvId: string,
  mainConvId: string,
  content: string
): NotificationTarget[] {
  const ids = operatorConvId === mainConvId ? [operatorConvId] : [operatorConvId, mainConvId];
  return ids.map((conversation_id) => ({ conversation_id, role: 'assistant', content }));
}
