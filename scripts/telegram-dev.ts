import { getBot } from '../lib/telegram';
import { handleTelegramUpdate } from '../lib/telegram-router';

// Local Telegram runner using long polling — no public URL/webhook needed.
// Reuses the exact same handler as the production webhook route.
async function main() {
  const bot = getBot();
  if (!bot) {
    console.error('TELEGRAM_BOT_TOKEN is not set — cannot start the bot.');
    process.exit(1);
  }

  bot.on('message', async (ctx) => {
    try {
      await handleTelegramUpdate({ message: ctx.update.message });
    } catch (e) {
      console.error('[telegram-dev] handler error:', e);
    }
  });
  bot.catch((e) => console.error('[telegram-dev] bot error:', e));

  console.log('🤖 Telegram long-polling started. Send /start <token> to your bot.');
  await bot.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
