import { getBot } from '../lib/telegram';

// Forward updates to the app's HTTP webhook endpoint so that SSE broadcasts
// fire in the same process as the web server (in-memory pub/sub requires this).
const APP_URL = process.env.APP_BASE_URL ?? 'http://app:3000';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';

// Additional app URLs to fan-out to (comma-separated), e.g. QC1/QC2 instances.
// Each URL receives the same update so tokens stored in their respective DBs resolve.
const EXTRA_URLS = (process.env.EXTRA_APP_URLS ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

async function forwardToUrl(url: string, update: object, isPrimary: boolean): Promise<void> {
  try {
    const res = await fetch(`${url}/api/telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
        ...(isPrimary ? {} : { 'x-telegram-fanout': 'extra' })
      },
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(30_000)
    });
    console.log(`[telegram-dev] forward to ${url} → ${res.status}`);
    if (!res.ok) {
      console.error(`[telegram-dev] forward to ${url} failed:`, res.status, await res.text().catch(() => ''));
    }
  } catch (e) {
    console.error(`[telegram-dev] forward to ${url} threw:`, (e as Error).message);
  }
}

async function forwardUpdate(update: object): Promise<void> {
  await Promise.allSettled([
    forwardToUrl(APP_URL, update, true),
    ...EXTRA_URLS.map((url) => forwardToUrl(url, update, false))
  ]);
}

// Local Telegram runner using long polling — no public URL/webhook needed.
// Forwards each update to the app HTTP webhook so SSE sync works across containers.
async function main() {
  const bot = getBot();
  if (!bot) {
    console.error('TELEGRAM_BOT_TOKEN is not set — cannot start the bot.');
    process.exit(1);
  }

  // Forward EVERY update (message + callback_query for the /agent inline picker).
  bot.use(async (ctx) => {
    try {
      const text = ctx.message?.text ?? ctx.callbackQuery?.data ?? '(no text)';
      const from = ctx.from?.id ?? '?';
      console.log(`[telegram-dev] update from=${from} text=${text} → forwarding to ${[APP_URL, ...EXTRA_URLS].join(', ')}`);
      await forwardUpdate(ctx.update);
    } catch (e) {
      console.error('[telegram-dev] handler error:', e);
    }
  });
  bot.catch((e) => console.error('[telegram-dev] bot error:', e));

  // Register the slash-command menu (the "/" suggestions in Telegram).
  await bot.api
    .setMyCommands([
      { command: 'agent', description: 'Changer d’agent (main ↔ opérateur)' },
      { command: 'leads', description: 'Lister les leads' },
      { command: 'lead', description: 'Détail d’un lead <nom|email>' },
      { command: 'lead_history', description: 'Historique conversation <nom|email>' },
      { command: 'pool', description: 'Visiteurs anonymes' },
      { command: 'help', description: 'Aide / liste des commandes' }
    ])
    .catch((e) => console.error('[telegram-dev] setMyCommands failed:', e));

  console.log('🤖 Telegram long-polling started. Send /start <token> to your bot.');
  await bot.start({ allowed_updates: ['message', 'callback_query'] });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
