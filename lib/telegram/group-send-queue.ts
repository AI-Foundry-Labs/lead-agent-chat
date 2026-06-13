/**
 * Per-group Telegram send queue — red-team C1 mitigation.
 *
 * Telegram hard-caps a bot at ~20 messages/minute/group (HTTP 429 beyond that).
 * This queue throttles outbound sends to ~1 per 3 s per group (~20/min).
 *
 * Drop policy:
 *   - 'mirror'   messages are dropped (oldest-first) when queue size > MAX_QUEUE_SIZE.
 *   - 'critical' messages (operator replies, handoff, takeover) are NEVER dropped.
 *
 * This is intentionally single-process / in-memory. A note on multi-instance:
 * if the app is deployed as multiple replicas, each instance has its own queue
 * and the per-group rate is multiplied by instance count. For v1 (<100 active
 * leads/agency) this is acceptable; a Redis-backed queue is the upgrade path.
 */

import { getBot } from '@/lib/telegram';

/** How many ms between sends for a single group (~20/min = 1/3 s). */
const SEND_INTERVAL_MS = 3_000;

/** Max queued mirror messages per group before oldest mirrors are dropped. */
const MAX_QUEUE_SIZE = 50;

/** Max ms to wait when Telegram returns 429 without a retry_after header. */
const DEFAULT_BACKOFF_MS = 10_000;

export type SendKind = 'mirror' | 'critical';

interface QueueItem {
  text: string;
  threadId: number | undefined;
  kind: SendKind;
  resolve: (ok: boolean) => void;
}

/** Per-group state: queue + drain timer handle. */
interface GroupQueue {
  items: QueueItem[];
  timer: ReturnType<typeof setTimeout> | null;
}

const queues = new Map<string, GroupQueue>();

function getOrCreateQueue(chatId: string): GroupQueue {
  let q = queues.get(chatId);
  if (!q) {
    q = { items: [], timer: null };
    queues.set(chatId, q);
  }
  return q;
}

/** Drop oldest mirror items until queue length ≤ MAX_QUEUE_SIZE. Log drops. */
function enforceDropPolicy(chatId: string, q: GroupQueue): void {
  let dropped = 0;
  while (q.items.length >= MAX_QUEUE_SIZE) {
    // Find the oldest mirror item.
    const mirrorIdx = q.items.findIndex((i) => i.kind === 'mirror');
    if (mirrorIdx === -1) break; // all items are critical — stop dropping
    const [dropped_item] = q.items.splice(mirrorIdx, 1);
    dropped_item.resolve(false);
    dropped++;
  }
  if (dropped > 0) {
    console.warn(
      `[group-send-queue] chatId=${chatId} dropped ${dropped} mirror message(s) — queue was full`
    );
  }
}

/** Send one item, retrying on 429 with back-off. */
async function trySend(
  chatId: string,
  item: QueueItem
): Promise<void> {
  const bot = getBot();
  if (!bot) {
    console.warn('[group-send-queue] bot not configured — dropping send to', chatId);
    item.resolve(false);
    return;
  }

  const params: Record<string, unknown> = { chat_id: chatId, text: item.text };
  if (item.threadId !== undefined) {
    params.message_thread_id = item.threadId;
  }

  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    try {
      await bot.api.sendMessage(chatId, item.text, {
        message_thread_id: item.threadId
      });
      item.resolve(true);
      return;
    } catch (e: unknown) {
      const err = e as Record<string, unknown>;
      // grammY wraps Telegram API errors; 429 carries retry_after in error_parameters.
      const isRateLimit =
        (err?.error_code === 429) ||
        (typeof err?.message === 'string' && err.message.includes('429'));

      if (isRateLimit) {
        const retryAfter =
          (err?.parameters as Record<string, unknown> | undefined)?.retry_after;
        const waitMs =
          typeof retryAfter === 'number'
            ? retryAfter * 1_000
            : DEFAULT_BACKOFF_MS;
        console.warn(
          `[group-send-queue] 429 on chatId=${chatId}; backing off ${waitMs}ms (attempt ${attempts})`
        );
        await delay(waitMs);
      } else {
        console.error('[group-send-queue] sendMessage error on chatId=' + chatId + ':', e);
        item.resolve(false);
        return;
      }
    }
  }
  // Exhausted retries.
  console.error('[group-send-queue] exhausted retries for chatId=' + chatId);
  item.resolve(false);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Drain the next item from the queue, then schedule the next drain. */
async function drainNext(chatId: string): Promise<void> {
  const q = queues.get(chatId);
  if (!q || q.items.length === 0) {
    if (q) q.timer = null;
    return;
  }

  const item = q.items.shift()!;
  await trySend(chatId, item);

  // Schedule next drain regardless of success/failure.
  q.timer = setTimeout(() => void drainNext(chatId), SEND_INTERVAL_MS);
}

/**
 * Enqueue a message for delivery to a Telegram group.
 *
 * Returns a promise that resolves to true on delivery, false on drop/error.
 * For fire-and-forget callers, discard the promise.
 */
export function enqueueGroupSend(
  chatId: string,
  text: string,
  opts: { threadId?: number; kind: SendKind }
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const q = getOrCreateQueue(chatId);
    q.items.push({ text, threadId: opts.threadId, kind: opts.kind, resolve });
    enforceDropPolicy(chatId, q);

    // Kick off the drain loop if it isn't already running.
    if (q.timer === null) {
      q.timer = setTimeout(() => void drainNext(chatId), 0);
    }
  });
}

/** Exposed for tests — current queue depth for a group. */
export function getQueueDepth(chatId: string): number {
  return queues.get(chatId)?.items.length ?? 0;
}
