const STORAGE_KEY = 'lead_pending_conversations';
const MAX_PENDING = 50;

export function getPendingConversationIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

export function addPendingConversationId(id: string): void {
  if (typeof window === 'undefined') return;
  const ids = getPendingConversationIds();
  if (ids.includes(id)) return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([id, ...ids].slice(0, MAX_PENDING))
  );
}

export function removePendingConversationIds(claimed: string[]): void {
  if (typeof window === 'undefined' || claimed.length === 0) return;
  const claimedSet = new Set(claimed);
  const remaining = getPendingConversationIds().filter((id) => !claimedSet.has(id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
}
