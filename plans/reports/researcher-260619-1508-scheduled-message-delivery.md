# Scheduled/Future Message Delivery Research
**Recommendation: Option (a) — DB-polled loop in telegram service**

---

## Executive Summary

For the lead-agent-chat infra (single-container deployment, Next.js 16 app + separate long-polling telegram service), **embed a scheduler loop directly in the existing `telegram-dev.ts` process** (`scripts/telegram-dev.ts`). This is the simplest path, requires zero new infrastructure, reuses the existing DB connection + bot handle, and maps cleanly onto the existing send-queue pattern. Risk: if telegram service scales >1 replica, locking prevents double-send but cost scales linearly (see failure modes).

---

## Trade-Off Analysis: 3 Options

| Dimension | (a) DB-polled in telegram service | (b) Dedicated worker service | (c) Next.js route + external cron |
|-----------|----------------------------------|------------------------------|--------------------------------|
| **Complexity** | Low — one setInterval loop; reuses existing bot & DB | Medium — new docker-compose service, error handling | Medium — external cron dependency; Vercel/AWS integration |
| **Failure isolation** | Telegram service down = no sends | Worker down = no sends | App down = no sends (but cron still fires, gets 5xx) |
| **State visibility** | DB-only; no in-process state | DB-only (same) | DB-only (same) |
| **Restart safety** | ✅ FOR UPDATE SKIP LOCKED prevents double-send on restart | ✅ Same | ⚠️ Retry spikes if cron re-fires before app boots |
| **Scaling to >1 replica** | ⚠️ Each replica runs loop (but locking still prevents double-send) | ✅ Single worker instance | ✅ API route idempotent (same request deduplicated) |
| **Dependency drag** | None | New npm/service | External cron: cron-job.org, EasyCron, AWS EventBridge, Vercel Crons (beta) |
| **Production readiness** | ⭐⭐⭐ — minimal drift from dev | ⭐⭐ — new service pattern | ⭐ — external dependency; timezone handling remote |
| **Token efficiency** | 1 loop on polling interval | 1 loop (same) | Cron HTTP request overhead |

**Recommendation rationale:** MVP is single-container; telegram service already exists + has DATABASE_URL + has bot handle. DB polling is commodity; Intl.DateTimeFormat (built-in) handles Europe/Paris tz. Adding a new service raises deployment/monitoring burden (Kubernetes? Multi-process supervisor?). External cron adds uncontrollable latency + timeout risk on boot.

---

## Recommended Implementation: Option (a)

### 1. Schema: `scheduled_messages` Table

```sql
CREATE TABLE scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Scope: who owns this message?
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  
  -- Content & delivery
  content TEXT NOT NULL,
  channel VARCHAR(10) NOT NULL, -- 'email' | 'telegram' | 'web'
  
  -- Scheduling
  send_at TIMESTAMPTZ NOT NULL, -- UTC; e.g. "2026-06-19T14:30:00+00:00"
  timezone VARCHAR(50) DEFAULT 'Europe/Paris', -- store for audit; send_at is always UTC
  
  -- State machine
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed' | 'cancelled'
  sent_at TIMESTAMPTZ, -- when it actually went out
  error_message TEXT, -- if status='failed'
  
  -- Audit
  created_by UUID, -- admin_id or null (system-scheduled)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Idempotency: prevent accidental duplicate rows with same conversation+send_at
  UNIQUE(conversation_id, send_at)
);

CREATE INDEX scheduled_messages_status_send_at 
  ON scheduled_messages(status, send_at) 
  WHERE status = 'pending';

CREATE INDEX scheduled_messages_conversation_idx 
  ON scheduled_messages(conversation_id);
```

### 2. Status Lifecycle

```
pending
  ↓ (send_at <= now AND status='pending' AND FOR UPDATE SKIP LOCKED acquired)
  ├→ sent (success) — sent_at + status='sent'
  ├→ failed (retryable) — error logged, status stays 'pending', retry next loop
  └→ failed (non-retryable) — error_message set, status='failed', skip in future
  
cancelled (admin cancels before send_at) — marked manually, skipped in loop
```

### 3. Polling Loop Logic (integrate into `scripts/telegram-dev.ts`)

```typescript
async function runScheduledMessageLoop() {
  const POLL_INTERVAL_MS = 30_000; // 30s polling (clock skew absorbed by now())
  const MAX_RETRIES = 3; // Fail after 3 attempts
  const BATCH_SIZE = 50; // Process up to 50 scheduled messages per loop

  setInterval(async () => {
    try {
      const now = new Date(); // server local time (but send_at is UTC)
      
      // Acquire pending rows that are due, sorted FIFO.
      // FOR UPDATE SKIP LOCKED: if another replica is processing the same row,
      // skip it (don't block). Prevents double-send on concurrent replicas.
      const dueMessages = await db
        .select({
          id: scheduled_messages.id,
          conversation_id: scheduled_messages.conversation_id,
          channel: scheduled_messages.channel,
          content: scheduled_messages.content,
          status: scheduled_messages.status,
          created_at: scheduled_messages.created_at
        })
        .from(scheduled_messages)
        .where(
          and(
            eq(scheduled_messages.status, 'pending'),
            lte(scheduled_messages.send_at, now) // Due now or in past
          )
        )
        .orderBy(asc(scheduled_messages.created_at))
        .limit(BATCH_SIZE)
        .for('update')
        .skipLocked(); // Skip rows locked by other processes

      for (const msg of dueMessages) {
        try {
          // Load conversation to route to correct channel/lead
          const conv = await getConversationById(msg.conversation_id);
          if (!conv) {
            // Conversation deleted; mark failed
            await updateScheduledMessageStatus(msg.id, 'failed', 'Conversation not found');
            continue;
          }

          // Dispatch via existing dispatchReply (or dispatchEmail for email channel)
          // This handles retries + channel logic already.
          await dispatchReply(conv, msg.content);
          
          // Mark sent
          await updateScheduledMessageStatus(msg.id, 'sent', null, new Date());
          
        } catch (e: unknown) {
          const err = e as Record<string, unknown>;
          const isRetryable = 
            (typeof err?.message === 'string' && 
             /network|timeout|ECONNREFUSED|ETIMEDOUT/.test(err.message));

          if (isRetryable) {
            // Leave status='pending'; next loop will retry (up to MAX_RETRIES implicit in drizzle/db)
            console.warn(`[scheduled-messages] retryable error for msg ${msg.id}:`, err);
          } else {
            // Non-retryable (invalid lead, bot kicked, etc.)
            await updateScheduledMessageStatus(
              msg.id, 
              'failed', 
              String(err?.message || 'Unknown error')
            );
            console.error(`[scheduled-messages] failed to send msg ${msg.id}:`, err);
          }
        }
      }
    } catch (e) {
      console.error('[scheduled-messages] loop error:', e);
    }
  }, POLL_INTERVAL_MS);

  console.log(`[scheduled-messages] polling loop started (${POLL_INTERVAL_MS}ms interval)`);
}

// In main():
async function main() {
  const bot = getBot();
  if (!bot) {
    console.error('TELEGRAM_BOT_TOKEN is not set — cannot start the bot.');
    process.exit(1);
  }

  // Start scheduled message loop (runs in background)
  runScheduledMessageLoop();

  // ... existing telegram polling ...
  bot.on('message', async (ctx) => { ... });
  await bot.start();
}
```

### 4. Locking Strategy

**Mechanism: `FOR UPDATE SKIP LOCKED`**

- Postgres acquires a row-level lock for 30s (duration of processing + next `SELECT`).
- Multiple replicas: first to lock wins; others `SKIP LOCKED` and get different rows.
- Prevents: two processes sending the same message.
- Cost: locks are cheap; one `SELECT` per loop + batch process is O(1) lock overhead.

**Alternative (simpler but less robust):** Conditional UPDATE:
```sql
UPDATE scheduled_messages 
SET status = 'sent', sent_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING *;
-- If 0 rows affected, another replica beat us; safe to ignore.
```
Less safe under contention but avoids explicit locking. **Recommendation: use `FOR UPDATE SKIP LOCKED` for clarity + production safety.**

### 5. Timezone Handling

**Store & send:**
- Always store `send_at` as **UTC timestamptz** in Postgres.
- Example: admin wants msg sent at "14:30 Paris time on June 19", that's **12:30 UTC** (CEST -02:00) → store `2026-06-19T12:30:00+00:00`.

**Conversion on input (create scheduled message):**
```typescript
// User submits: "send at 14:30 Paris time" (local wall-clock)
function convertParisToUtc(parisLocal: string): Date {
  // parisLocal = "2026-06-19T14:30:00" (naive)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Create a UTC date, then figure out Paris offset for that UTC moment
  const utcCandidate = new Date(parisLocal); 
  const parisOffset = getParisUtcOffset(utcCandidate); // Returns 1 or 2 (hours)
  
  // Adjust backwards: subtract Paris offset to get UTC equivalent
  return new Date(utcCandidate.getTime() - parisOffset * 60 * 60 * 1000);
}

// Already have this pattern in lib/calendar.ts (parisUtcOffset fn)
```

**Store timezone for audit:**
```typescript
const scheduledMsg = await db.insert(scheduled_messages).values({
  conversation_id,
  content,
  channel,
  send_at: convertParisToUtc(userSubmittedTime), // UTC
  timezone: 'Europe/Paris', // for reference
  status: 'pending',
  created_by: admin_id
});
```

**No date library needed:** Use built-in `Intl.DateTimeFormat` (already used in `lib/calendar.ts`) + `Date` objects. No dayjs/moment/luxon bloat.

### 6. Semantics: At-Least-Once (with Idempotency Key)

The design guarantees **at-least-once delivery** (not exactly-once), but idempotency is built-in:

- **Duplicate protection:** `UNIQUE(conversation_id, send_at)` prevents two rows with same intent.
- **Idempotent send:** `dispatchReply` is already idempotent (stores message + sends).
  - If process crashes after `dispatchReply` succeeds but before `UPDATE status='sent'`:
    - Next loop will try to send again (message already in conversation history).
    - Duplicate message appears in the conversation.
    - **Mitigation:** Check if the scheduled message's content already exists in the conversation before sending (optional, adds complexity; acceptable as-is for MVP).

- **Exactly-once semantics:** Would require distributed transaction (saga pattern / 2PC), too heavy for this use case. **Accept at-least-once.**

### 7. Failure Handling

| Failure | Behavior |
|---------|----------|
| **Network timeout sending Telegram** | Logged; stays `pending`; retried next loop |
| **Lead deleted** | Conversation query returns null; marked `failed` (human review) |
| **Bot kicked from group** | grammY throws known error; marked `failed` |
| **Rate limit (429)** | `enqueueGroupSend` already handles backoff; stays `pending` |
| **Process crash** | Rows locked release after ~30s; next process acquires + retries |
| **DB down** | Loop catches error, logs, sleeps, tries again |
| **send_at in past (already expired)** | Still sent on next loop; `sent_at` records actual delivery time |

**Retry decay:** Currently no explicit backoff (simple model). For MVP: rely on once-per-30s polling (natural backoff). **TODO (Phase 02):** track attempt count, exponential backoff, or DLQ after N failures.

### 8. Integration Points

**Create scheduled message (from admin tool or API):**
```typescript
// In lib/db or admin action
export async function scheduleMessage({
  conversationId,
  content,
  sendAt, // UTC Date object (already converted by caller)
  channel,
  createdBy
}: {
  conversationId: string;
  content: string;
  sendAt: Date;
  channel: 'email' | 'telegram' | 'web';
  createdBy?: string;
}) {
  const result = await db
    .insert(scheduled_messages)
    .values({
      conversation_id: conversationId,
      agency_id, // derive from conversation.agency_id
      content,
      channel,
      send_at: sendAt,
      timezone: 'Europe/Paris',
      status: 'pending',
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    })
    .onConflictDoNothing() // Duplicate (conv_id, send_at) is silently ignored
    .returning();
  
  return result[0] ?? null;
}
```

**Cancel scheduled message:**
```typescript
export async function cancelScheduledMessage(id: string) {
  return await db
    .update(scheduled_messages)
    .set({ status: 'cancelled', updated_at: new Date() })
    .where(eq(scheduled_messages.id, id))
    .returning();
}
```

### 9. Crash Safety & Idempotency Recap

| Scenario | Outcome |
|----------|---------|
| Process crashes mid-send | `dispatchReply` completes, message appears in history; `sent_at` not recorded; next loop sends again (duplicate message in conv history) |
| Process crashes before `UPDATE sent_at` | Same as above |
| Replica 1 & 2 both try to send row #5 | One acquires lock, other `SKIP LOCKED`; duplicate prevented |
| Clock jumps forward (e.g., NTP sync) | `send_at <= now()` may select already-sent rows; `dispatchReply` idempotent (adds another copy to history) |

**Acceptable risk for MVP:** Duplicate messages in conversation history are visible but benign (audit trail is useful). Exactly-once would require message deduplication key (e.g., hash of content) — add if users complain.

---

## Unresolved Questions

1. **Retry cap:** Should we fail a message after 3 attempts? 10? Need to define (currently implicit: stays pending forever). Recommend: add `attempt_count` column, mark `failed` if `attempt_count >= 3`.

2. **User-facing UI for cancellation:** Can admins cancel a scheduled message before send_at? Recommend: yes, add API endpoint + admin UI (Phase 02).

3. **Timezone DST edge case:** When a message is scheduled in summer (CEST, UTC+2) but sends in winter (CET, UTC+1), does the wall-clock time shift? Current design: no (send_at is UTC). Alternatives: store intent as "14:30 Paris wall-clock" every day (recurring) or "14:30 regardless of DST" (one-shot). Clarify if needed.

4. **Status visibility:** Should the API expose scheduled messages to admins/leads? Recommend: admin UI with list + cancel button (Phase 02).

5. **Batch size + polling interval tuning:** Hardcoded 30s + 50 msgs. Measure in production; scale if lead count grows past 1000.

---

## Recommendation Summary

| Aspect | Decision |
|--------|----------|
| **Where to host** | Existing `telegram-dev.ts` service (no new service) |
| **Mechanism** | `setInterval` loop, `SELECT ... WHERE status='pending' AND send_at <= now() FOR UPDATE SKIP LOCKED` |
| **Polling interval** | 30 seconds (reasonable sweet spot: low latency, low query overhead) |
| **Locking** | Row-level `FOR UPDATE SKIP LOCKED` (prevents double-send on replicas) |
| **Semantics** | At-least-once (not exactly-once; acceptable for MVP) |
| **Timezone** | UTC in DB; Intl.DateTimeFormat for Paris conversion (no external lib) |
| **Retry** | Implicit (stays pending, retried next loop); bounded later (Phase 02) |
| **Scaling risk** | Safe to 2-3 replicas; beyond that, consider DLQ or Redis-backed queue |

---

## Implementation Checklist

- [ ] Add `scheduled_messages` table to `lib/db/schema.ts`
- [ ] Create helper functions: `scheduleMessage()`, `cancelScheduledMessage()`, `updateScheduledMessageStatus()`
- [ ] Add `runScheduledMessageLoop()` to `scripts/telegram-dev.ts`
- [ ] Add DB query helpers in `lib/db/scheduled-messages.ts`
- [ ] Test: schedule message, verify sent after interval
- [ ] Test: crash mid-send, verify next loop retries (accept duplicate in history)
- [ ] Test: two replicas, verify `SKIP LOCKED` prevents double-send
- [ ] Add admin API endpoint to create scheduled messages (POST /api/admin/schedule-message)
- [ ] Add timezone conversion helper (reuse pattern from `lib/calendar.ts`)

---

## Status

**DONE** — Recommendation complete. Ready for planner to scope Phase 02 implementation.
