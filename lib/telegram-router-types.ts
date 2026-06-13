// Minimal shape we read from a Telegram update — shared by the webhook route and
// the local long-polling dev runner so the behaviour is identical.
export interface TelegramUpdate {
  // Unique monotonic ID — used for idempotency deduplication.
  update_id?: number;
  message?: {
    text?: string;
    // Thread id when the message belongs to a forum topic.
    message_thread_id?: number;
    from?: {
      id?: number | string;
      // true when the sender is a bot (e.g. the bot's own mirror posts).
      is_bot?: boolean;
    };
    chat?: {
      id?: number | string;
      // 'private' | 'group' | 'supergroup' | 'channel'
      type?: string;
      // true when the supergroup has Topics (forum mode) enabled
      is_forum?: boolean;
    };
  };
}
