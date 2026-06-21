/**
 * Scheduled-message delivery loop (F4a). Started once from instrumentation.ts
 * when RUN_SCHEDULER is enabled. Per-tick errors are swallowed so a transient DB
 * blip never tears down the loop (or the host process).
 */
import { deliverDueScheduledMessages } from './deliver-due-scheduled-messages';

const DEFAULT_INTERVAL_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduledMessageLoop(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (timer) return; // idempotent — never start twice in one process
  console.log('[scheduler] scheduled-message loop started, interval', intervalMs, 'ms');
  timer = setInterval(() => {
    deliverDueScheduledMessages()
      .then((n) => {
        if (n > 0) console.log('[scheduler] delivered', n, 'scheduled message(s)');
      })
      .catch((e) => console.error('[scheduler] tick failed (non-fatal):', e));
  }, intervalMs);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
}
