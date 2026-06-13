---
title: Agency-Scoped Telegram + Multi-Tenant Lead Channels
slug: agency-telegram-multitenant
created: 2026-06-13
status: completed
mode: hard
blockedBy: []
blocks: []
---

# Agency-Scoped Telegram + Multi-Tenant Lead Channels

## Goal

Turn the single-agency product into a multi-tenant platform where Telegram is an
**agency-only** control surface. Each agency links ONE Telegram supergroup (forum).
Every lead (web form / web chat) gets **two forum topics** in that group:

- **💬 Conversation** — live mirror of lead↔agent; admin reply here = takeover (to customer).
- **🤖 Assistant** — per-lead copilot (existing `operator` conversation) for the agency.

Agent auto-replies stay synced across web + Telegram. On handoff, push a notification
to the agency group; takeover works from **both** web and the Telegram topic.

## Key Decisions (locked with user)

- **Full multi-tenant now** — new `agencies` table + `agency_id` FK across core tables.
- **2 topics per lead (v1)** — maps onto existing `lead` + `operator` conversation types (no new type). Copilot built in v1.
- **One global bot** (single token/webhook); bot is admin of each agency group.
- **Full mirror** of lead↔agent turns into Topic 1 (final reply/turn, via per-group throttle queue).
- **Agency routing: Host/subdomain → agency** (primary); listing as consistency check; default as fallback.
- **Scale: small (<100 active leads/agency)** → topic-per-lead is fine; auto-archive stays out of scope (YAGNI).
- **Lead-DM Telegram flow** (visitor `/start` linking) — **kept as-is**, not touched this round.
- **Takeover from both** web and Telegram topic.

## Architecture (one paragraph)

One global bot serves N agency supergroups. `agencies.telegram_group_chat_id` binds an
agency to its forum group. `lead_telegram_topics` maps a lead → (group, conversation_topic_id,
assistant_topic_id, operator_conversation_id). The agent loop is unchanged per-turn; new
dispatch logic mirrors lead/agent turns into Topic 1 and routes inbound group messages by
`message_thread_id`: Topic 1 → lead takeover path, Topic 2 → operator agent turn, General/`/link`
→ agency binding. Every query gains an `agency_id` scope.

## Phases

| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 01 | [Multi-tenant data model + lead→agency assignment](phase-01-multi-tenant-data-model.md) | completed | — |
| 02 | [Agency Telegram group linking + sender→admin resolver](phase-02-agency-telegram-group-linking.md) | completed | 01 |
| 03 | [Per-lead forum topics](phase-03-per-lead-forum-topics.md) | completed | 01,02 |
| 04 | [Two-way sync + routing + send throttle](phase-04-two-way-sync-and-routing.md) | completed | 03 |
| 05 | [Handoff + dual takeover](phase-05-handoff-and-dual-takeover.md) | completed | 04 |
| 06 | [Tests, migration safety, docs](phase-06-tests-migration-docs.md) | completed | 05 |

## Red-Team Resolutions (load-bearing)

- **Lead→agency assignment (was missing — biggest hole):** an anonymous web visitor must resolve to an agency *before* a lead row exists. **v1 rule (host-first, per validation):** request **Host/subdomain → agency** is the primary resolver (true SaaS multi-tenant, e.g. `foncia.app.com`); `listings.agency_id` is a consistency check; default agency only as last-resort fallback. Needs a domain→agency mapping + middleware reading the `Host` header. Specified in Phase 01.
- **Telegram 20 msg/min/group cap (hard 429):** full token-mirror of every agent reply is infeasible for busy agencies. v1 mirrors **lead inbound + final agent reply (one message/turn, not streamed) + handoff/admin events** through a **per-group send queue with throttle + drop-oldest-mirror policy** (takeover/handoff messages are never dropped). Specified in Phase 04.
- **Operator turn needs an admin identity Topic 2 lacks:** add a `telegram_user_id → agency admin` resolver (Phase 02). Group sender unmapped → **reject with hint**, never silent-fallback to a wrong admin.
- **Registered-group guard:** webhook rejects group updates whose `chat.id ∉ agencies.telegram_group_chat_id` (Phase 02/04).
- **Real migration, not seed backfill:** explicit drizzle migration (nullable → backfill UPDATE → verify → NOT NULL); seed only seeds fresh DBs (Phase 01/06).
- **Idempotency:** dedupe inbound by Telegram `update_id`; treat only human Topic-1 messages as takeover (Phase 04).

## Key Dependencies

- Telegram Bot API forum-topic methods (`createForumTopic`, `sendMessage` w/ `message_thread_id`,
  `closeForumTopic`, `editForumTopic`) — via grammY.
- Bot must be **group admin** with *Manage Topics* right (also bypasses privacy mode → receives all group messages).
- Postgres migration via `drizzle-kit` (`db:push`); existing single-tenant data must backfill to a default agency.

## Out of Scope (YAGNI)

- Per-agency separate bots / branding (revisit only if lead-facing bot identity needed).
- Removing/refactoring the visitor lead-DM Telegram flow.
- Auto-archiving aged topics (note as follow-up; not built v1).
- Billing, agency self-signup, RBAC beyond existing admin auth.

## Outcome

### Shipped
- **Multi-tenant core:** agencies root tenant, `agency_id` FK across 7 core tables, per-agency scoped queries.
- **Agency-only Telegram:** one global bot, per-agency supergroup (forum) binding via `/link <token>` command.
- **Per-lead dual topics:** 💬 Conversation (lead↔agent mirror) + 🤖 Assistant (per-lead copilot). Lazy creation, idempotent under concurrency.
- **Two-way sync + routing:** Lead/agent turns mirror into Topic 1 via per-group send queue (throttle: ~20 msg/min, drop-oldest-mirror policy). Inbound group messages route by `message_thread_id` → Topic 1 (takeover), Topic 2 (operator), General/unknown (ignored). Echo-loop prevention via `is_bot` filter + idempotency dedup.
- **Handoff + dual-surface takeover:** Handoff fires → notify agency group (Topic 1 + General). Admin takeover from Telegram Topic 1 or web UI; both flip `conversations.mode` (single SoT), relay admin text to customer's real channel, broadcast to web. Resumable via `/resume` or web button.

### Security Fixes (3 critical + 1 additional found in sweep)
1. **C1 — Spoofable x-agency-id header:** Client-supplied header stripped unconditionally, server-side resolution is SoT.
2. **C2 — Cross-tenant IDOR (admin operator chat):** Added `lead.agency_id` ownership check; routes return 404 on mismatch.
3. **C3 — Cross-tenant IDOR (admin actions):** `resolveVisitorThread` now scoped by `agency_id`; routes return 404 on mismatch.
4. **Found during sweep — Cross-tenant read (SSE stream):** `app/api/admin/stream/route.ts` added `conv.agency_id` guard before opening SSE.

Plus guard sweep: 4 more endpoints hardened (threads, conversation, actions listing/rule mutations).

### Test Coverage
- **128 unit tests** (up from 47): agency group verification (18), lead title builders (30), send queue drop policy (27), host-resolution (21), group message routing (7). All pure/DB-free.
- **226 agent tests** green (regression verified). Typecheck clean.
- **Known gaps for post-merge:** Integration/smoke tests deferred (require live/mocked Telegram API + concurrent DB access). Unit tests validate pure decision logic; integration tests needed for tenant isolation E2E, echo-loop, operator containment, handoff flow.

### Known Follow-ups (documented, not blocking)
1. **Smoke tests:** Run on agency group verification + route DB lookups.
2. **Integration tests:** Tenant isolation (cross-agency query verification), echo-loop, operator topic containment, handoff/takeover with Telegram mocking.
3. **Multi-instance send-queue:** In-memory only. Redis-backed queue is documented upgrade path if >1 replica before scaling.
4. **Supergroup max-topics ceiling:** Unverified; stated scale (<100 active leads/agency) assumed safe. Verify before high-volume deployment.
5. **Migration on existing DBs:** `db:push` is a 3-step manual process on non-empty databases (nullable → backfill → NOT NULL). Documented; seed only seeds fresh DBs.
6. **IPv6 dev-host parsing:** Handles bracket notation `[::1]` correctly; production IPv6 with port uses first `:` split (limitation noted in code).
