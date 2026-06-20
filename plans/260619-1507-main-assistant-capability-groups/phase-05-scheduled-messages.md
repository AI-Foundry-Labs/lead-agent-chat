# Phase 05 — Scheduled messages + delivery (F4a)

## Context Links
- Overview: [plan.md](plan.md) · Foundations: [phase-00](phase-00-foundations-shared.md)
- Research (delivery decision): `plans/reports/researcher-260619-1508-scheduled-message-delivery.md`
- Delivery primitives: `lib/dispatch.ts` (`dispatchReply`), `lib/db/messages.ts` (`addMessage`)
- Host process: `scripts/telegram-dev.ts` (long-running tsx, has DATABASE_URL, runs `bot.start()`)
- Audit: `recordAudit` (Phase 04)

## Overview
- **Priority:** P2 · **Status:** pending · **Risk:** HIGH (only feature needing a background loop)
- main_assistant schedules a message to a lead for a future time. New table + create/list/cancel tools
  + a DB-polled delivery loop. Done last (infra risk).

## Key Insights
- No existing scheduler. **Recommended (per research): DB-polled loop hosted inside the existing
  telegram poller process** (`scripts/telegram-dev.ts`). Simplest correct option for current
  single-ish-container deploy. No new service, no external cron.
- Loop: every ~30–60s, `SELECT ... WHERE status='pending' AND send_at<=now() FOR UPDATE SKIP LOCKED`
  → for each: load conversation, `addMessage(role 'admin')`, `dispatchReply(conv, content)`,
  mark `sent`. SKIP LOCKED makes it safe even if telegram service scaled >1 replica.
- **At-least-once** delivery (NOT exactly-once): a crash mid-send may re-deliver. Acceptable; the
  message appears in conversation history either way. Document.
- **Timezone:** store `send_at` as `timestamptz` (UTC). Admin thinks in Europe/Paris wall-clock →
  convert on input using `Intl` (no date lib in package.json; pattern exists in `lib/calendar.ts`).
- Cancel = `UPDATE ... SET status='cancelled' WHERE id=? AND status='pending'`.

## Requirements
**Functional:**
- `schedule_message(lead_id, content, send_at_local, channel?)` — create pending row.
- `list_scheduled_messages(lead_id?)` — pending/sent/cancelled for agency (or one lead).
- `cancel_scheduled_message(id)` — cancel if still pending.
- Background loop delivers due messages.
**Non-functional:** agency-scoped; idempotent claim; loop never crashes the poller; tz correct.

## Architecture
- `scheduled_messages`: `id, agency_id, conversation_id, lead_id, content text, send_at timestamptz,
  channel varchar?, status ('pending'|'sent'|'cancelled'|'failed'), created_by uuid, attempt_count int,
  sent_at timestamptz?, error text?, created_at timestamptz`.
  Partial index: `(status, send_at) WHERE status='pending'`.
- **Claim/deliver** (`lib/scheduling/deliver-due-scheduled-messages.ts`):
  ```
  BEGIN;
    SELECT * FROM scheduled_messages
      WHERE status='pending' AND send_at <= now()
      ORDER BY send_at LIMIT 50 FOR UPDATE SKIP LOCKED;
    -- for each: load conv → addMessage(admin) → dispatchReply → UPDATE status='sent', sent_at=now()
    -- on send error: attempt_count++; if >=3 → status='failed', error=...
  COMMIT;
  ```
  Use postgres.js transaction. Keep batch ≤50.
- **Loop host** (`lib/scheduling/scheduled-message-loop.ts`): `setInterval(deliverDue, 30_000)`, guarded
  try/catch per tick. Started from `scripts/telegram-dev.ts` AFTER `bot.start()` wiring (non-blocking).
- **TZ helper** (`lib/scheduling/paris-time.ts`): parse admin local input ("2026-06-20 14:30" Europe/Paris)
  → UTC Date. Use `Intl.DateTimeFormat` offset technique. ~50 LOC, no dependency.
- Audit: `schedule_message` → `recordAudit('scheduled_message_created')`; delivery → `'scheduled_message_sent'`.

## Related Code Files
**Create:**
- `lib/db/schema.ts` addition: `scheduled_messages` table + partial index.
- `lib/db/scheduled-messages.ts` — CRUD + claim-due query (~120 LOC).
- `lib/scheduling/deliver-due-scheduled-messages.ts` — claim+deliver tx (~120 LOC).
- `lib/scheduling/scheduled-message-loop.ts` — interval host (~50 LOC).
- `lib/scheduling/paris-time.ts` — Intl-based local↔UTC (~60 LOC).
- `lib/agent/tools/main-assistant/scheduled-messages.ts` — `buildScheduledMessagesTools(ctx, adminId)` (~140 LOC).

**Modify:**
- `lib/db/client.ts`, `lib/db/index.ts` — exports.
- `scripts/telegram-dev.ts` — start the loop after bot wiring (guarded).
- `lib/agent/tools/main-assistant/index.ts` — register builder.
- `lib/agent/prompts/main-assistant-prompt.ts` — note scheduling + that times are Europe/Paris.

## Implementation Steps
1. Add `scheduled_messages` table + partial index; migrate.
2. CRUD + claim-due query in `lib/db/scheduled-messages.ts`.
3. `paris-time.ts` local↔UTC helper + unit test.
4. `deliver-due-scheduled-messages.ts`: tx with `FOR UPDATE SKIP LOCKED`, addMessage+dispatchReply,
   status transitions, attempt cap=3.
5. `scheduled-message-loop.ts` interval; start from `telegram-dev.ts` (guarded, after bot).
6. Tools: schedule/list/cancel (+ recordAudit). Validate `send_at` is future; reject past.
7. Register; prompt note (times Europe/Paris).
8. typecheck/build; manual: schedule +1min → loop delivers → row 'sent', message in thread.

## Todo List
- [ ] scheduled_messages table + partial index + migrate
- [ ] db CRUD + claim-due query
- [ ] paris-time helper + unit test
- [ ] deliver-due tx (SKIP LOCKED, attempt cap)
- [ ] loop host + start in telegram-dev.ts (guarded)
- [ ] schedule/list/cancel tools + audit
- [ ] register + prompt note + typecheck/build + manual delivery test

## Success Criteria
- Scheduling a message for T+1min delivers it once at ~T (±loop interval) into the lead's thread on
  the right channel; row → 'sent'. Cancel before due prevents send. Process restart does not double-send
  already-sent rows. Past send_at rejected. Paris wall-clock interpreted correctly.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Double-send on restart/concurrency | Med×Med | `FOR UPDATE SKIP LOCKED` + status transition in same tx; at-least-once accepted |
| Loop crash kills telegram poller | Low×High | Per-tick try/catch; loop start guarded, isolated from bot |
| Telegram service scaled >1 → multiple loops | Low×Med | SKIP LOCKED handles it; if undesired, gate loop behind env flag (RUN_SCHEDULER) |
| TZ/DST wrong send time | Med×Med | Store UTC; Intl conversion; unit test DST boundary |
| Sends to a lead whose channel/contact is gone | Med×Low | dispatchReply no-ops if no chatId/email; mark sent anyway (or failed) — decide OQ-05-3 |
| Lead erased (Phase 04) but message still scheduled | Med×Med | conversation_id FK cascade or skip+cancel if lead gone |

## Security / GDPR Considerations
- Scheduled sends to leads must respect consent (e.g. marketing follow-up requires marketing consent) —
  consider checking `view_consent_status` at delivery (flag, OQ-05-4).
- Audit creation + delivery via `recordAudit` (Phase 04 dependency).
- Erasure must cancel/delete a lead's pending scheduled messages.

## Next Steps
- Final phase. After this, docs-manager updates `docs/system-architecture.md` + changelog.

## OPEN QUESTIONS
- **OQ-05-1:** Confirm delivery host = telegram poller process (recommended) vs new worker service vs
  external cron. Also: is there a PROD process that stays alive, or only the dev poller? (prod deploy unclear).
- **OQ-05-2:** Gate the loop behind an env flag (e.g. `RUN_SCHEDULER=1`) so only one process runs it?
- **OQ-05-3:** If a lead's channel contact is missing at delivery → mark 'sent' (best-effort) or 'failed'?
- **OQ-05-4:** Should delivery check marketing consent before sending follow-ups, or is that the agent's
  responsibility at schedule time? Proposed: agent's responsibility; flag if compliance wants enforcement.
- **OQ-05-5:** Retry cap = 3 attempts acceptable? Any alerting on 'failed'?
- **OQ-05-6:** Max schedule horizon / per-lead pending cap to prevent abuse?
