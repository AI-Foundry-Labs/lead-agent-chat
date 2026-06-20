/**
 * Next.js instrumentation hook — runs once per server process at startup.
 * Hosts the scheduled-message delivery loop (F4a) in the always-on app server
 * (prod has no separate worker/poller; only the Next.js app stays alive).
 *
 * Gated by RUN_SCHEDULER so exactly one instance/process runs it when scaling
 * horizontally (the loop is also concurrency-safe via FOR UPDATE SKIP LOCKED).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // skip edge runtime
  const flag = process.env.RUN_SCHEDULER;
  if (flag !== '1' && flag !== 'true') return;
  const { startScheduledMessageLoop } = await import(
    '@/lib/scheduling/scheduled-message-loop'
  );
  startScheduledMessageLoop();
}
