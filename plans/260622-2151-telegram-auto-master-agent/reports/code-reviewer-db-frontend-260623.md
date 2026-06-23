# Code Review — Data Layer + Frontend + Integrations

Date: 2026-06-23 · Reviewer: code-reviewer · Scope: whole-codebase (lib/db, lib/calendar|email|events, lib/scheduling, components, app non-API)

## Overall Assessment
Data layer is mature: agency-scoping is consistent across query helpers, single-use tokens use atomic conditional `UPDATE ... RETURNING`, anon-seq increment is a single SQL statement, the anonymous-attach TOCTOU is closed (`attachLeadIfAnonymous`). No SQL injection, no `dangerouslySetInnerHTML`, no secret leakage to client bundles. The serious findings are a few hot-path N+1 / missing-index issues and one transaction-holds-network-IO concern in the scheduler, plus a self-inflicted SSE reconnect bug on the admin client.

`persona` drift is resolved in code: schema places `persona` on `admins` (schema.ts:250) and all consumers (auth.ts, run.ts, data route, persona route, admin tools) agree. Only a live-DB `drizzle push` migration remains to verify operationally — no code drift.

---

## Critical
None.

---

## Important

### I1. Scheduler holds row lock across external network I/O
`lib/scheduling/deliver-due-scheduled-messages.ts:20-63`. `deliverOne` opens `db.transaction`, locks a row with `FOR UPDATE SKIP LOCKED`, then inside the same tx calls `dispatchReply(conv, ...)` (line 37) which performs `sendTelegramMessage` / `sendEmail` (network, seconds-scale). The row lock — and the tx — is held for the full duration of an external API call. `deliverDueScheduledMessages` loops up to `MAX_PER_TICK=50` serially, so one tick can hold locks across 50 sequential network round-trips. Risk: lock contention, long-running transactions, connection-pool pressure under load.
- Also: `getConversation`, `addMessage`, `broadcastConversationUpdate` (lines 33-36) use the global `db`, not `tx` — they run outside the locking transaction's isolation, so the "claim-and-deliver atomically" guarantee is weaker than the comment implies (only the status flip on lines 39-42/52-59 is transactional).
- Fix: claim the row (flip to an in-flight/`sending` state) in a short tx, commit, THEN dispatch outside the tx, then a second short tx to finalize `sent`/`failed`. Keeps locks off the network path.

### I2. N+1 on the admin dashboard data route
`app/api/admin/data/route.ts:35-53`. After fetching identified leads, it `await`s `listConversationsByLeadId(l.id)` once per lead — purely to compute `thread_count: threads.length`. N leads = N+1 queries, each pulling full conversation rows to take a `.length`. This is the primary admin panel payload (auto-refetched on every SSE agency-data event, debounced 500ms). Fix: single `GROUP BY lead_id COUNT(*)` over conversations scoped to the agency, joined in memory.

### I3. Missing indexes on hot filter columns (leads)
`lib/db/schema.ts:110-145`. `leads` is indexed only on `agency_id`. But:
- `getLeadByEmail` (leads.ts:38) filters `email` + `agency_id` — login / magic-link path.
- `getLeadByTelegramUserId` (lead-telegram-links.ts:12) and `getMostRecentTelegramLeadId` filter `telegram_user_id` — runs on EVERY inbound Telegram DM.
Both scan within the agency on unindexed columns. Add indexes on `(agency_id, email)` and `(telegram_user_id)`.

### I4. In-app filtering of unbounded lead scans
`lib/db/leads.ts:59-78`. `listLeadsByStatus` and `listIdentifiedLeads` `SELECT *` all leads for the agency then `.filter()` in JS. Grows linearly with tenant lead count, fetched fully into memory. Push the predicate into SQL (`WHERE status = ?` / a `WHERE email IS NOT NULL OR name IS NOT NULL`-style filter) and add `LIMIT`/pagination for the dashboard list.

### I5. Admin SSE clients kill native reconnect on any transient error
`components/admin/admin-shell.tsx:72` and `components/admin/operator-chat-panel.tsx:60`: `es.onerror = () => es.close()`. EventSource auto-reconnects by default; calling `close()` in `onerror` permanently tears down the stream on the first transient network blip (Wi-Fi hiccup, proxy timeout, server redeploy). The admin then silently stops receiving live updates until the component remounts. Note `components/chat/chat-panel.tsx:79-89` does NOT do this and is correct (relies on native reconnect + treats POST response as authoritative). Fix: drop the `onerror`→`close` handler, or only close on a permanent condition.

### I6. `telegram_user_id` not unique → possible cross-agency DM misroute
`getLeadByTelegramUserId` (lead-telegram-links.ts:12-21) selects `.limit(1)` with no ordering and no agency filter; the lead carries its own `agency_id` so routing follows the lead. But there is no DB unique constraint on `leads.telegram_user_id`. If the same Telegram user is a lead in two agencies, the query returns an arbitrary row → DM routed to the wrong tenant's conversation (`handle-private-telegram-message.ts:164`). Decide the invariant: either a unique/partial-unique constraint, or scope the lookup deterministically (e.g. order by `updated_at desc` and document the "most recent agency wins" rule).

---

## Minor

- **M1. `cancelViewing` / `rescheduleViewing` not agency-scoped** — `lib/db/viewings.ts:121-145` mutate by `viewingId` only. Whoever calls them must enforce the agency boundary (IDOR risk if a caller passes an attacker-supplied id). Confirm callers scope; ideally add `agency_id` to the `WHERE`.
- **M2. `upsertAgencyConfig` read-then-write race** — config.ts:26-47: two concurrent first-time upserts both see no existing row → both INSERT; the `agency_config_agency_id_unique` constraint makes the loser throw (unhandled). Rare (one config per agency, set at seed). Use `ON CONFLICT DO UPDATE`.
- **M3. `claimConversationsForLead` N+1** — conversations.ts:87-102 loops `getConversation` + `updateConversation` per id. Bounded by pending-claim list size (small), but could be one conditional bulk UPDATE with `inArray` + agency/anon guards.
- **M4. `getLeadByTelegramUserId` double round-trip** — selects `id` then calls `getLeadById(id)` (two queries). Just `SELECT *`.
- **M5. Magic-link email interpolates `name`/`url` into raw HTML** — email.ts:77-86. `name` comes from lead-controlled input. Low risk (recipient = the lead themselves, email clients sandbox), but unescaped. Escape before interpolation.
- **M6. Email listing inference is naive** — email.ts:106 parses `[listing:xxx]` from subject; documented as such. Fine for v1.
- **M7. `audit_log.target_lead_id` intentionally has no FK** (schema.ts:494) so erasure rows survive — correct design, noted for completeness.

---

## Positive Observations
- Token consume helpers (agency/lead Telegram, magic-link) are atomic single-use via conditional `UPDATE ... RETURNING` — no TOCTOU.
- `attachLeadIfAnonymous` (conversations.ts:297) closes the promote-anonymous race with one conditional UPDATE.
- `incrementAnonSeq` / `setAgencyMasterTopic` use atomic SQL / conditional updates — concurrency-safe.
- SSE server routes (chat/stream, admin/stream) have heartbeat, abort-driven cleanup, and agency-scoped access checks (`assertLeadChatAccess`, `conv.agency_id !== adminAgencyId`).
- `recordAudit` is best-effort/non-throwing — correct posture for non-critical writes.
- F4d helpers (consents, message-templates) are uniformly agency-scoped including the get/update/delete-by-id paths (no IDOR).
- ChatBubble renders content as text node — no XSS.

---

## Unresolved Questions
1. I1: is there an external lock/queue (e.g. single scheduler instance via `RUN_SCHEDULER`) that makes the long-held-lock concern moot in practice? If only one instance ever runs the loop, the contention risk drops but the long-tx/pool concern remains.
2. I6: what is the intended invariant for one Telegram user across multiple agencies — disallowed, or "most recent wins"?
3. M1: do all callers of `cancelViewing`/`rescheduleViewing` already enforce agency scope upstream?

---

**Status:** DONE
**Summary:** Data layer and integrations are solid and well-scoped; no critical/security blockers. Top issues are hot-path performance (N+1 + missing indexes) and a scheduler transaction holding locks across network I/O, plus a client SSE reconnect bug.
**Top 3 findings:** (1) I1 scheduler holds `FOR UPDATE` lock across `dispatchReply` network calls; (2) I2 admin data route N+1 (`listConversationsByLeadId` per lead for a count); (3) I5 admin SSE `onerror→close` defeats EventSource auto-reconnect.
