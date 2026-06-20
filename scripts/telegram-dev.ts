import { getBot } from '../lib/telegram';

// Forward updates to the app's HTTP webhook endpoint so that SSE broadcasts
// fire in the same process as the web server (in-memory pub/sub requires this).
const APP_URL = process.env.APP_BASE_URL ?? 'http://app:3000';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';

async function forwardUpdate(update: object): Promise<void> {
  const res = await fetch(`${APP_URL}/api/telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': WEBHOOK_SECRET
    },
    body: JSON.stringify(update)
  });
  if (!res.ok) {
    console.error('[telegram-dev] forward failed:', res.status, await res.text().catch(() => ''));
  }
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
