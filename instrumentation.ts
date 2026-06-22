/**
 * Next.js instrumentation hook — runs once per server process at startup.
 * Hosts the scheduled-message delivery loop (F4a) in the always-on app server
 * (prod has no separate worker/poller; only the Next.js app stays alive).
 *
 * Gated by RUN_SCHEDULER so exactly one instance/process runs it when scaling
 * horizontally (the loop is also concurrency-safe via FOR UPDATE SKIP LOCKED).
 */
const BOT_COMMANDS = [
  { command: 'agent',        description: "Changer d'agent (main ↔ opérateur)" },
  { command: 'leads',        description: 'Lister les leads' },
  { command: 'lead',         description: 'Détail d\'un lead <nom|email>' },
  { command: 'lead_history', description: 'Historique conversation (sélection ou <nom|email>)' },
  { command: 'pool',         description: 'Visiteurs anonymes' },
  { command: 'help',         description: 'Aide / liste des commandes' },
];

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // skip edge runtime

  // Register slash-command menu so Telegram shows clean /cmd (no @botname suffix).
  const { getBot } = await import('@/lib/telegram');
  const b = getBot();
  if (b) {
    b.api.setMyCommands(BOT_COMMANDS, { scope: { type: 'all_group_chats' } })
      .catch((e) => console.warn('[instrumentation] setMyCommands failed:', e));
    b.api.setMyCommands(BOT_COMMANDS, { scope: { type: 'all_private_chats' } })
      .catch((e) => console.warn('[instrumentation] setMyCommands (private) failed:', e));
  }

  // Warm up /api/telegram so the first real Telegram update doesn't hit a 14s cold compile.
  const appUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (secret) {
    fetch(`${appUrl}/api/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
      body: JSON.stringify({ update_id: 0 })
    }).catch(() => {});
  }

  const flag = process.env.RUN_SCHEDULER;
  if (flag !== '1' && flag !== 'true') return;
  const { startScheduledMessageLoop } = await import(
    '@/lib/scheduling/scheduled-message-loop'
  );
  startScheduledMessageLoop();
}
