/**
 * Telegram webhook management (production setup).
 *
 * Registers (or inspects / deletes) the single global webhook that Telegram
 * uses to deliver updates for ALL agencies. Run once per public domain.
 *
 * Usage:
 *   npm run telegram:webhook            # set webhook to <APP_BASE_URL>/api/telegram
 *   npm run telegram:webhook -- info    # show current webhook status
 *   npm run telegram:webhook -- delete  # remove the webhook (e.g. to use long-polling)
 *
 * Requires env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_BASE_URL.
 * The secret is echoed by Telegram in the `x-telegram-bot-api-secret-token`
 * header and verified in app/api/telegram/route.ts.
 */
import { getBot } from '../lib/telegram';

const cmd = process.argv[2] ?? 'set';

async function main() {
  const bot = getBot();
  if (!bot) {
    console.error('[webhook] TELEGRAM_BOT_TOKEN is not set — aborting.');
    process.exit(1);
  }

  if (cmd === 'info') {
    const info = await bot.api.getWebhookInfo();
    console.log('[webhook] current status:');
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (cmd === 'delete') {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    console.log('[webhook] deleted. Bot now has no webhook (long-polling possible).');
    return;
  }

  // default: set
  const base = process.env.APP_BASE_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!base) {
    console.error('[webhook] APP_BASE_URL is not set — aborting.');
    process.exit(1);
  }
  if (!secret) {
    console.error('[webhook] TELEGRAM_WEBHOOK_SECRET is not set — aborting (the API route requires it).');
    process.exit(1);
  }
  if (!base.startsWith('https://')) {
    console.error(`[webhook] APP_BASE_URL must be https:// for Telegram webhooks (got: ${base}).`);
    process.exit(1);
  }

  const url = `${base.replace(/\/$/, '')}/api/telegram`;
  await bot.api.setWebhook(url, {
    secret_token: secret,
    // message: chat/group messages · callback_query: inline-keyboard taps
    // my_chat_member: bot promoted to admin → auto-bind group to agency.
    allowed_updates: ['message', 'callback_query', 'my_chat_member']
  });
  console.log(`[webhook] set to ${url}`);
  const info = await bot.api.getWebhookInfo();
  console.log(`[webhook] confirmed url: ${info.url}, pending: ${info.pending_update_count}`);
}

main().catch((e) => {
  console.error('[webhook] failed:', e);
  process.exit(1);
});
