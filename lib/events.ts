// In-process pub/sub for SSE. Subscribers are keyed by conversation id so any
// open client (web browser, admin dashboard) re-fetches when a turn lands. This
// is what makes "session sync" work: every client of a conversation is notified.
type Subscriber = () => void;

const conversationSubs = new Map<string, Set<Subscriber>>();
const globalSubs = new Set<Subscriber>();

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
