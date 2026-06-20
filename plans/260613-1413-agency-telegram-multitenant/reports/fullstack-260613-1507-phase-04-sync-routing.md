# Phase 04 Implementation Report — Two-Way Sync + Topic Routing

## Files Modified / Created

| File | Action | Lines |
|------|--------|-------|
| `lib/telegram-router-types.ts` | Modified | +7 (update_id, message_thread_id, from.is_bot) |
| `lib/telegram.ts` | Modified | sendTelegramMessage gains optional `opts.message_thread_id` |
| `lib/dispatch.ts` | Modified | +2 imports, +mirrorLeadTurnToTopic |
| `lib/agent/run.ts` | Modified | +mirror calls for lead inbound + final reply |
| `lib/telegram/group-send-queue.ts` | Created | 160 lines |
| `lib/telegram/route-group-message.ts` | Created | 76 lines |
| `lib/telegram/handle-private-telegram-message.ts` | Created | 155 lines (extracted from handler) |
| `lib/telegram/handle-lead-telegram-update.ts` | Rewritten | 200 lines (was 259, now split) |
| `eval_harness/unit/route-group-message-classify.test.ts` | Created | 57 lines, 7 tests |

## Routing Table

| Condition | Handler | Result |
|-----------|---------|--------|
| `chat.type` private, `/start <token>` | admin or lead link flow | unchanged |
| `chat.type` private, no /start | admin/lead message dispatch | unchanged |
| group, `/link <token>` | `handleAgencyGroupLink` | bind group→agency |
| group, `chat.id ∉ agencies` | — | `ignored` |
| group, `from.is_bot === true` | echo filter | `ignored` |
| group, duplicate `update_id` | idempotency dedup | `ignored` |
| group, `thread_id === conversation_topic_id` | `handleAgencyTakeoverMessage` (stub) | `group` (no-op Phase 04) |
| group, `thread_id === assistant_topic_id` | `handleOperatorTopicMessage` | `group`, reply → Topic 2 only |
| group, general / unmatched thread | — | `ignored` |

## Queue / Drop Policy

**File:** `lib/telegram/group-send-queue.ts`

- Per-group keyed map; single drain loop per group, 3 s interval (~20/min).
- On HTTP 429: back off with `retry_after` seconds (default 10 s), up to 5 retries.
- `kind: 'mirror'` — oldest-first drop when queue > 50 items. Count is logged.
- `kind: 'critical'` (operator replies, handoff, takeover) — NEVER dropped.
- In-memory only. Multi-instance note: each replica has its own queue; acceptable for v1 (<100 active leads/agency). Redis-backed queue is the documented upgrade path.
- `getQueueDepth(chatId)` exported for tests/monitoring.

## Echo-Loop Safety Reasoning

1. **is_bot filter** (line ~51 of main dispatcher): when the bot sends a mirror into Topic 1, Telegram delivers it back as a webhook update with `from.is_bot = true`. The filter catches this before any routing logic runs — no DB lookups needed.
2. **Operator reply path**: `runAgentTurn` for `actor.type === 'operator'` calls `dispatchReply`; `shouldDispatchReply` returns `false` for `operator` type (checked in `run.ts`). The explicit `enqueueGroupSend` in `handleOperatorTopicMessage` targets Topic 2 only. The operator reply IS sent by the bot, so `is_bot = true` on its webhook echo — filtered at step 1.
3. **Private-chat flows unchanged** — no echo risk there (1:1 DM, not a group).

## How Operator Stays Internal

- `dispatchReply` already has no branch for `type === 'operator'` — it silently returns for that type. Confirmed in `lib/dispatch.ts`.
- The explicit group send in `handleOperatorTopicMessage` uses `threadId = mapping.assistant_topic_id` (Topic 2). Even if the queue or thread ID were wrong, `dispatchReply` provides a second layer of isolation.
- `mirrorLeadTurnToTopic` in `dispatch.ts` only fires for `conversation.type === 'lead'`; operator conversations are `type === 'operator'` so mirror is never triggered for them.

## Tests

- `npm run typecheck` — PASS (clean)
- `npm run test` — 47/47 PASS (40 existing + 7 new `classifyGroupThread` unit tests)
- `npm run test:agent` — 226/226 PASS

## Unresolved Questions

- `from.first_name` is not in the current `TelegramUpdate` type; the `from` object passed to handlers carries `id` only. Phase 05 may want to display the admin's Telegram name in Topic 1 ACK — either extend the type or use the DB `admin.name`.
- Multi-instance queue: noted as in-memory only. If the app scales beyond one replica before Phase 06, the 20/min cap may be exceeded without a shared rate-limiter.
- `update_id` dedup set is process-scoped. Restarts clear it — fine for v1 (Telegram retry window is ~30 s; brief restart is unlikely to overlap). Long-running retry storms are not a concern for the current scale.

---

**Status:** DONE
**Summary:** Phase 04 fully implemented — per-group send queue (throttle + drop policy), pure group router, mirror hook in agent turn, operator Topic-2 copilot with admin resolver gate, echo-loop filters, idempotency dedup, and Phase 05 takeover stub. All files under 200 lines. Typecheck + 273 tests pass.
