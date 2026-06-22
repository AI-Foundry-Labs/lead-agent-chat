// Minimal shape we read from a Telegram update — shared by the webhook route and
// the local long-polling dev runner so the behaviour is identical.
export interface TelegramUpdate {
  // Unique monotonic ID — used for idempotency deduplication.
  update_id?: number;
  // Inline-keyboard button taps arrive here instead of message.
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number | string };
    message?: {
      chat?: { id?: number | string };
      message_thread_id?: number;
    };
  };
  // Fired when the bot's own membership/rights in a chat change (e.g. promoted
  // to admin). Used to auto-bind a group to an agency without a /link token.
  my_chat_member?: {
    chat?: {
      id?: number | string;
      // 'private' | 'group' | 'supergroup' | 'channel'
      type?: string;
      is_forum?: boolean;
    };
    // The user who changed the bot's status (added/promoted it).
    from?: { id?: number | string; is_bot?: boolean };
    // The bot's membership BEFORE the change.
    old_chat_member?: { status?: string };
    // The bot's membership AFTER the change ('administrator' when promoted).
    new_chat_member?: { status?: string; can_manage_topics?: boolean };
  };
  message?: {
    // Per-chat message id — used to react to / reply to a specific message.
    message_id?: number;
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
