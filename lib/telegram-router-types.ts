// Minimal shape we read from a Telegram update — shared by the webhook route and
// the local long-polling dev runner so the behaviour is identical.
export interface TelegramUpdate {
  message?: {
    text?: string;
    from?: { id?: number | string };
    chat?: { id?: number | string };
  };
}
