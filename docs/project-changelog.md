# Project Changelog

All notable changes to lead-agent-chat are documented here.

## [2026-06-20] Main Assistant Capability Groups (F1, F4a–d)

### Features

Five new capability groups for the `main_assistant` agent, assembled in `lib/agent/tools/main-assistant/index.ts`:

1. **Message Template Library (F4b)** — CRUD tools for reusable message templates. Placeholders: `{{name}}`, `{{email}}`, `{{listing_title}}`, `{{agency_name}}`. Unresolved placeholders left literal + warned (non-blocking send).
2. **Telegram Message-History Search (F4c)** — Extended `search_messages` with channel filter ('web'|'email'|'telegram'|'all'). Results tagged with `surface: 'dm'` or `'group'`. Fixed cross-agency leak in prior implementation.
3. **Anonymous Visitor Pool (F1)** — Tools for listing, reading, and identifying anonymous visitors. Identification requires name OR email; ephemeral if neither. No merge. Reuses `promoteAnonymousVisitor` logic.
4. **GDPR Consent + Audit Log (F4d)** — Consent table (`lead_consents`, append-only, cascade on lead delete) + audit log (`audit_log`, `target_lead_id` has no FK for erasure record survival). Tools: set/view consent, view audit history, export lead data (Art. 15). Audit recording wired into sensitive tools (lead_viewed, lead_updated, lead_qualified, message_sent, lead_identified, lead_erasure_executed, etc.) via `recordAudit` helper. Erasure = hard-delete, no PII trace.
5. **Scheduled Messages with Background Delivery (F4a)** — Schedule tools + delivery loop. Stores in `scheduled_messages` table; delivery via polled background loop in `lib/scheduling/deliver-due-scheduled-messages.ts` (at-least-once, retry cap 3, `FOR UPDATE SKIP LOCKED` for multi-instance safety). Times in Europe/Paris timezone. Loop hosted in `lib/instrumentation.ts` `register()` hook, gated by `RUN_SCHEDULER` env (default off, enable on one app instance only). **GDPR Limitation:** Telegram group messages cannot be remotely deleted on erasure (documented limitation); legal-basis/privacy-policy wording and retention auto-purge out of scope.

### Scheduler Infrastructure

- **Host:** Instrumentation loop (`lib/instrumentation.ts` `register()`).
- **Safety:** `FOR UPDATE SKIP LOCKED` for multi-instance-safe claiming.
- **Deployment:** Prod uses single app server (no separate worker); scheduler runs inside app process.
- **Environment:** `RUN_SCHEDULER=true` enables polling; set on exactly one app instance.

### Database Schema

New tables added via idempotent migration `0002_sweet_cannonball.sql`:
- `message_templates` — Library of reusable messages per agency.
- `lead_consents` — Append-only consent log; cascades on lead delete.
- `audit_log` — Append-only audit log; `target_lead_id` has no FK (survives lead erasure).
- `scheduled_messages` — Pending/sent/failed messages with retry state + send_at timestamp.

### New Files

- `lib/db/message-templates.ts` — `createTemplate`, `updateTemplate`, etc.
- `lib/db/consents.ts` — `recordConsent`, `getConsent`.
- `lib/db/audit-helpers.ts` — `recordAudit` (call-site: best-effort, non-blocking).
- `lib/db/audit-log.ts` — `getAuditHistoryForLead`.
- `lib/db/scheduled-messages.ts` — `scheduleMessage`, `listScheduled`, `cancelScheduled`.
- `lib/agent/tools/main-assistant/templates.ts` — Zod-validated CRUD + render.
- `lib/agent/tools/main-assistant/visitor-pool.ts` — Anonymous visitor tools.
- `lib/agent/tools/main-assistant/gdpr.ts` — Consent + audit + erasure tools.
- `lib/agent/tools/main-assistant/scheduled-messages.ts` — Schedule/list/cancel with Paris timezone.
- `lib/scheduling/deliver-due-scheduled-messages.ts` — Claim-and-deliver loop.
- `lib/scheduling/scheduled-message-loop.ts` — Polling interval driver.
- `lib/scheduling/paris-time.ts` — Europe/Paris ↔ UTC conversion (Intl-based, no new dependency).

### Modified Files

- `lib/agent/tools/main-assistant/index.ts` — Register 5 new tool builders (barrel).
- `lib/agent/tools/main-assistant/messaging.ts` — Extended `search_messages` with channel filter + agency scope fix.
- `lib/agent/tools/main-assistant/visitor-pool.ts` — Identification reuses `promoteAnonymousVisitor` + `is-identified-lead` gate.
- `lib/db/schema.ts` — Four new tables: `message_templates`, `lead_consents`, `audit_log`, `scheduled_messages`.
- `lib/db/leads.ts` — `deleteLead` extended for cascade + audit recording.
- `lib/dispatch.ts` — Audit recording wired into `dispatchReply`.
- `lib/instrumentation.ts` — Register scheduler loop (gated by `RUN_SCHEDULER`).
- `lib/agent/prompts/main-assistant-prompt.ts` — Capability notes appended per phase.

### Migration & Deployment

- Migrations are now **idempotent:** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded constraints.
- Docker entrypoint runs migrate from BAKED `/migrate` copy (not bind mount), so schema changes require `docker compose build app telegram` to ship migration into image.
- Prod path uses `RUN_DB_PUSH=true` (also picks up rebuilt schema).

### Test Coverage

- `npm run typecheck` — PASS (clean).
- `npm run test` — All tests passing.
- `npm run test:agent` — All tests passing.

### Backward Compatibility

- All new tools scoped by `agency_id`; existing tools unchanged.
- Scheduler opt-in via `RUN_SCHEDULER` env (default off).
- Message templates optional; search/GDPR/visitor tools do not break existing flows.

---

## [2026-06-14] Anonymous Visitor Promotion to Leads

### Features

- **Anonymous lead sequencing:** Visitors with ≥2 messages are promoted to anonymous leads with per-agency sequence number (`Visiteur #N`).
- **Telegram topic provisioning:** Promotion triggers creation of per-lead forum topics (💬 Conversation, 🤖 Assistant) with backfilled prior messages + context header.
- **Race-safe promotion:** Conditional attach logic in `promoteAnonymousVisitor` prevents duplicate provisioning.

### New Files

- `lib/telegram/promote-anonymous-visitor.ts` — `promoteAnonymousVisitor` (race-safe via conditional attach).

### Schema Changes

- `agencies.anon_seq_counter` (int, default 0) — Per-agency anonymous visitor counter.
- `leads.anon_seq` (int, nullable) — Sequence number for anonymous-promoted leads; null for identified leads.

### Modified Files

- `lib/db/agencies.ts` — `incrementAnonSeq` helper.
- `lib/db/conversations.ts` — `attachLeadIfAnonymous` for race-safe attachment.
- `lib/db/leads.ts` — `deleteLead`, `createLead` now accept `anon_seq` and `language` params.
- `lib/telegram/lead-topics.ts` — `buildLeadDisplayName` takes optional `anonSeq`.
- `app/api/chat/route.ts` — Promotion trigger on ≥2 user messages.

### Test Coverage

- `npm run typecheck` — PASS.
- `npm run test` — All tests passing.

---

## [2026-06-13] Multi-Tenant + Agency-Scoped Telegram

### Major Features

- **Multi-tenant architecture:** New `agencies` table (tenant root); `agency_id` FK on admins, leads, conversations, listings, handoff_rules, agency_config, viewing_slots.
- **Agency → host/subdomain resolver:** Middleware resolves request Host/subdomain to agency (primary); listing consistency check (secondary); default fallback (dev only). Client-supplied `x-agency-id` header unconditionally stripped.
- **Telegram shifted to agency control surface:** One global bot serves N agencies. Each agency links ONE supergroup (forum) via `/link <token>`. Per-lead two-topic model:
  - **Topic 1 (💬 Conversation):** Live lead↔agent mirror + admin takeover relays.
  - **Topic 2 (🤖 Assistant):** Per-lead copilot (`operator` conversation, internal only).
- **Per-group throttle queue:** ~20 msg/min cap (Telegram API limit). Mirror messages droppable (oldest-first if queue > 50); handoff/takeover/operator replies never dropped.
- **Dual takeover:** Mode set from both web (`POST /api/admin/actions`) and Telegram (Topic 1 admin reply). `conversations.mode` is single source of truth.
- **Handoff notifications:** Agency group (Topic 1 + General) notified when handoff occurs.
- **Kept existing flow:** Visitor lead-DM Telegram flow unchanged; both exist in parallel.

### Security Fixes (Four Critical + Two Important)

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| C1 | CRITICAL | Spoofable x-agency-id header | Client header unconditionally stripped; server-resolved only (middleware.ts:37). |
| C2 | CRITICAL | Cross-tenant IDOR in admin operator chat | Added `lead.agency_id !== admin.agency_id` guard; 404 on mismatch (app/api/admin/operator/chat/route.ts). |
| C3 | CRITICAL | Cross-tenant IDOR in admin actions | Fetch resource by ID, verify `agency_id` before mutation (app/api/admin/actions/route.ts). |
| C4 | CRITICAL | Cross-tenant read in SSE stream | Added agency check before opening stream (app/api/admin/stream/route.ts). |
| I2 | IMPORTANT | IPv6 dev-host parsing bug | Fixed bracket notation in Host header split (lib/agency-context.ts:28). |
| I1 | IMPORTANT | Admin route guard sweep | Added ownership checks to all resource-mutating routes (listings, rules). |

### New Files

- `lib/db/agencies.ts` — Agency queries.
- `lib/agency-context.ts` — Host → agency resolver.
- `lib/db/agency-telegram-links.ts` — Token + group binding.
- `lib/db/lead-telegram-topics.ts` — Per-lead topic storage.
- `lib/telegram/route-group-message.ts` — Group message dispatcher.
- `lib/telegram/group-send-queue.ts` — Throttle queue (3s drain, 20 msg/min).
- `lib/telegram/notify-agency.ts` — Handoff/event notifications.
- `lib/telegram/verify-agency-group.ts` — Registered group check.
- `lib/telegram/resolve-agency-admin.ts` — Sender → admin lookup.
- `lib/telegram/lead-topics.ts` — Forum topic management.
- `scripts/migrate-add-agency.ts` — Migration script.
- `middleware.ts` — Agency resolution + header security.

### Modified Files

- `lib/agent/run.ts` — Mirror dispatch hooks for lead turns.
- `lib/dispatch.ts` — `mirrorLeadTurnToTopic` hook.
- `lib/telegram/handle-lead-telegram-update.ts` — Rewritten (split private DM logic).
- `lib/telegram-router-types.ts` — Added `update_id`, `message_thread_id`, `from.is_bot`.
- `lib/telegram.ts` — `sendTelegramMessage` now accepts optional `message_thread_id`.
- All admin routes under `app/api/admin/*` — Added agency ownership guards.

### Breaking Changes

- **Telegram flow change:** Admin notifications now land in agency group (Topic 1) instead of per-admin DM. Visitor lead-DM flow still works.
- **All admin endpoints:** Now require matching `admin.agency_id` for resource access (404 if mismatch).

### Test Coverage

- `npm run typecheck` — PASS (clean).
- `npm run test` — 128/128 PASS (6 new tests in route-group-message).
- `npm run test:agent` — 226/226 PASS.

### Migration Notes

- Drizzle migration backfills existing (single-tenant) data to a default agency.
- Seed only runs on fresh DBs; existing data must be migrated via `db:push`.

---

## Previous Releases

(Earlier releases omitted; see git history for details.)
