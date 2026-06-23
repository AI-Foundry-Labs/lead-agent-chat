/**
 * Shared E2E helpers for the manual Telegram / lead-chat scenario drivers.
 *
 * Drives the app exactly like a real Telegram webhook (POST synthetic Update
 * JSON to /api/telegram) and like a real web client (POST /api/chat). The
 * server runs the real agent loop + DB writes, so assertions are made against
 * Postgres state + HTTP responses.
 *
 * Used by:
 *   - telegram-e2e-driver.ts            (slash-command smoke suite)
 *   - telegram-conversation-scenarios.ts (multi-turn lead↔agency scenarios)
 */

import postgres from 'postgres';

// ─── Config ────────────────────────────────────────────────────────────────

export const BASE = process.env.APP_BASE_URL_LOCAL ?? 'http://localhost:3300';
export const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
export const DB_URL = process.env.DATABASE_URL ?? '';

// A stable fake Telegram user id for the "admin" sending group messages.
// Not a bot → passes the is_bot echo filter. Not linked to any admin row →
// resolveActingAdmin falls back to the agency's primary admin (intended path).
export const FAKE_USER_ID = 999_000_111;

// ─── Postgres ────────────────────────────────────────────────────────────────

// postgres.js client. `.unsafe(sql, params)` runs a parameterized query and
// returns the rows directly (matches the project's existing DB driver).
const sqlClient = postgres(DB_URL, { prepare: false });

export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  return (await sqlClient.unsafe(text, params as never)) as unknown as T[];
}

export async function closeDb(): Promise<void> {
  await sqlClient.end().catch(() => {});
}

// ─── Telegram update builders ─────────────────────────────────────────────────

export interface GroupCtx {
  chatId: number;
  threadId: number;
}

let updateSeq = Date.now() % 1_000_000; // unique-ish, monotonically increasing

export function groupMessage(ctx: GroupCtx, text: string): object {
  updateSeq += 1;
  return {
    update_id: updateSeq,
    message: {
      message_id: updateSeq,
      from: { id: FAKE_USER_ID, is_bot: false, first_name: 'E2E', username: 'e2e_tester' },
      chat: { id: ctx.chatId, type: 'supergroup', title: 'Agency Group' },
      message_thread_id: ctx.threadId,
      date: Math.floor(updateSeq / 1000),
      text
    }
  };
}

export function callbackQuery(ctx: GroupCtx, data: string): object {
  updateSeq += 1;
  return {
    update_id: updateSeq,
    callback_query: {
      id: String(updateSeq),
      from: { id: FAKE_USER_ID, is_bot: false, first_name: 'E2E', username: 'e2e_tester' },
      message: {
        message_id: updateSeq,
        chat: { id: ctx.chatId, type: 'supergroup', title: 'Agency Group' },
        message_thread_id: ctx.threadId,
        date: Math.floor(updateSeq / 1000)
      },
      data
    }
  };
}

// ─── Transport ───────────────────────────────────────────────────────────────

/** POST a synthetic Telegram update to the webhook. Returns HTTP status. */
export async function postUpdate(update: object): Promise<number> {
  const res = await fetch(`${BASE}/api/telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-bot-api-secret-token': SECRET
    },
    body: JSON.stringify(update)
  });
  await res.text().catch(() => ''); // drain so the connection is freed
  return res.status;
}

export interface ChatResponse {
  status: number;
  conversationId: string | null;
  messages: { id: string; role: string; content: string; tool_calls: unknown }[];
  reply: string | null;
}

/** POST one lead web-chat turn. Pass conversationId to continue a thread. */
export async function postChat(body: {
  message: string;
  listingId?: string | null;
  conversationId?: string | null;
}): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = (await res.json().catch(() => null)) as {
    conversation?: { id: string };
    messages?: ChatResponse['messages'];
    reply?: string;
  } | null;
  return {
    status: res.status,
    conversationId: json?.conversation?.id ?? null,
    messages: json?.messages ?? [],
    reply: json?.reply ?? null
  };
}

/** GET a lead conversation's current messages — simulates a web client refetch. */
export async function getChat(conversationId: string): Promise<ChatResponse['messages']> {
  const res = await fetch(`${BASE}/api/chat?conversationId=${conversationId}`);
  const json = (await res.json().catch(() => null)) as { messages?: ChatResponse['messages'] } | null;
  return json?.messages ?? [];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Result tracking ─────────────────────────────────────────────────────────

export interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

export class Recorder {
  readonly results: StepResult[] = [];

  record(name: string, ok: boolean, detail = ''): void {
    this.results.push({ name, ok, detail });
    const icon = ok ? '✅' : '❌';
    console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  }

  report(): number {
    const passed = this.results.filter((r) => r.ok).length;
    const failed = this.results.length - passed;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`RESULT: ${passed}/${this.results.length} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('\nFailures:');
      for (const r of this.results.filter((x) => !x.ok)) {
        console.log(`  ❌ ${r.name} — ${r.detail}`);
      }
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return failed;
  }
}

// ─── Fixture resolution ────────────────────────────────────────────────────────

export interface Fixtures {
  agencyId: string;
  ctx: GroupCtx;
  leads: { id: string; anon_seq: number; status: string }[];
  primaryAdminId: string | null;
}

/** Resolve agency / group / leads / primary admin from the DB so drivers are portable. */
export async function resolveFixtures(): Promise<Fixtures> {
  if (!SECRET) throw new Error('TELEGRAM_WEBHOOK_SECRET missing from env');
  if (!DB_URL) throw new Error('DATABASE_URL missing from env');

  const [agency] = await q<{
    id: string;
    telegram_group_chat_id: string | null;
    telegram_master_topic_id: number | null;
  }>(
    `SELECT id, telegram_group_chat_id, telegram_master_topic_id
       FROM agencies WHERE telegram_group_chat_id IS NOT NULL LIMIT 1`
  );
  if (!agency?.telegram_group_chat_id) {
    throw new Error('No bound agency group found — bind a group first.');
  }

  const leads = await q<{ id: string; anon_seq: number; status: string }>(
    `SELECT id, anon_seq, status FROM leads WHERE agency_id = $1 ORDER BY anon_seq`,
    [agency.id]
  );

  const [primaryAdmin] = await q<{ id: string }>(
    `SELECT id FROM admins WHERE agency_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [agency.id]
  );

  return {
    agencyId: agency.id,
    ctx: {
      chatId: Number(agency.telegram_group_chat_id),
      threadId: agency.telegram_master_topic_id ?? 1
    },
    leads,
    primaryAdminId: primaryAdmin?.id ?? null
  };
}
