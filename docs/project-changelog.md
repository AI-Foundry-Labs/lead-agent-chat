# Project Changelog

All notable changes to lead-agent-chat are documented here.

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
