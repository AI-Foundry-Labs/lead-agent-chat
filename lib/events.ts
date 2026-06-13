// In-process pub/sub for SSE. Subscribers are keyed by conversation id so any
// open client (web browser, admin dashboard) re-fetches when a turn lands. This
// is what makes "session sync" work: every client of a conversation is notified.
type Subscriber = () => void;

const conversationSubs = new Map<string, Set<Subscriber>>();
const globalSubs = new Set<Subscriber>();

// Agency-scoped channel: admin dashboard subscribers are notified when
// config / listings / handoff rules change for their agency.
const agencySubs = new Map<string, Set<Subscriber>>();

/** Subscribe to agency-data-changed events for a specific agency. */
export function subscribeAgencyData(agencyId: string, fn: Subscriber): () => void {
  let set = agencySubs.get(agencyId);
  if (!set) {
    set = new Set();
    agencySubs.set(agencyId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) agencySubs.delete(agencyId);
  };
}

/** Notify all agency-data subscribers for the given agency. */
export function broadcastAgencyDataChanged(agencyId: string): void {
  const set = agencySubs.get(agencyId);
  if (set) for (const fn of set) safe(fn);
}

export function subscribeConversation(
  conversationId: string,
  fn: Subscriber
): () => void {
  let set = conversationSubs.get(conversationId);
  if (!set) {
    set = new Set();
    conversationSubs.set(conversationId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) conversationSubs.delete(conversationId);
  };
}

// Global subscribers hear about every conversation update (e.g. admin lead list).
export function subscribeGlobal(fn: Subscriber): () => void {
  globalSubs.add(fn);
  return () => globalSubs.delete(fn);
}

export function broadcastConversationUpdate(conversationId: string): void {
  const set = conversationSubs.get(conversationId);
  if (set) for (const fn of set) safe(fn);
  for (const fn of globalSubs) safe(fn);
}

function safe(fn: Subscriber) {
  try {
    fn();
  } catch {}
}
