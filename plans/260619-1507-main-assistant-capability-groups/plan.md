---
title: "main_assistant capability groups (F1, F4a-d)"
description: "5 capability groups for main_assistant: anon pool, scheduled msgs, templates, telegram search, GDPR consent/audit."
status: pending
priority: P2
effort: ~5d
branch: telegram
tags: [agent, main-assistant, telegram, gdpr, scheduling, drizzle]
created: 2026-06-19
---

# main_assistant capability groups

Extend the `main_assistant` agent (`lib/agent/tools/main-assistant/`) with 5 capability groups.
Each group = new/extended domain tool file registered in `index.ts` (`buildMainAssistantTools`).
Principles: YAGNI / KISS / DRY. Files <200 LOC, kebab-case. All scoped by `agency_id`.

## Phase ordering (by dependency + risk)

| # | Phase | Feature | Risk | Status | Depends on |
|---|-------|---------|------|--------|-----------|
| 00 | [Foundations: shared DB + tool wiring](phase-00-foundations-shared.md) | shared | Low | ✅ done | — |
| 01 | [Message template library](phase-01-template-library.md) | F4b | Low | ✅ done | 00 |
| 02 | [Telegram message-history search](phase-02-telegram-search.md) | F4c | Low | ✅ done | 00 |
| 03 | [Anonymous visitor pool for main_assistant](phase-03-anon-pool.md) | F1 | Med | ✅ done (no merge per decision) | 00 |
| 04 | [Consent / GDPR audit log](phase-04-gdpr-consent-audit.md) | F4d | Med | ✅ done | 00, 03 |
| 05 | [Scheduled messages + delivery](phase-05-scheduled-messages.md) | F4a | High | ✅ done (scheduler in instrumentation.ts) | 00, 04 |

Rationale: cheap/independent first (F4b, F4c — no new infra, pure read/CRUD), then F1
(reuses existing promote-anonymous + operator-pool logic), then F4d (touches many tool
bodies via one DRY helper — best done once F1 tools exist so they get audited too), then
F4a last (only feature needing a background loop = highest infra risk).

## Foundational / shared work (Phase 00, do first — avoid duplication)

- New domain tool files per feature; register each in `index.ts` barrel (single edit point).
- **Migration batching:** all new tables (`message_templates`, `lead_consents`, `audit_log`,
  `scheduled_messages`) added to `lib/db/schema.ts`; run `db:generate` + `db:migrate` ONCE per
  phase batch (project actually uses `db:push` per README — confirm with user, see OQ).
- Shared `recordAudit()` helper (built in Phase 04) is called from Phase 05 tools too.
- Shared Europe/Paris wall-clock <-> UTC conversion helper (built in Phase 05) — `Intl` based,
  no new dependency (no date lib in package.json).
- System prompt (`lib/agent/prompts/main-assistant-prompt.ts`, 149 LOC) gets a short capability
  note appended per phase — single owner per phase to avoid merge conflict.

## Key research inputs
- `plans/reports/researcher-260619-1508-scheduled-message-delivery.md` (F4a infra decision)
- `plans/reports/researcher-260619-1508-gdpr-consent-audit-design.md` (F4d design)

## Cross-cutting decisions
- All new tools scoped by `ctx.config.agency_id`; verify lead belongs to agency before acting.
- Tool inputs = Zod schemas; invalid args return tool error (existing convention).
- No new npm dependencies.

## RESOLVED DECISIONS (user-confirmed 2026-06-19 — authoritative, override per-phase OQs)
- **OQ-00-1 Migration (RESOLVED — infra fixed this session):** Root cause was twofold: (1) the boot
  migrate/seed runs from a BAKED `/migrate` copy in the image (Dockerfile copies lib/scripts/drizzle),
  NOT the bind-mounted `/app` — so schema edits never reached boot; (2) migration snapshots were
  DRIFTED (telegram_agent_sessions/persona/anon_seq/preferred_lang/anon_seq_counter were push-only,
  never generated), so a migrate-path DB was incomplete and seed failed on `anon_seq_counter`.
  FIX APPLIED: authored idempotent catch-up migration `drizzle/0002_sweet_cannonball.sql` (CREATE …
  IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / guarded ADD CONSTRAINT) capturing all drift + the new
  table; applied via migrator (safe on any partial state); rebuilt the app+telegram images so baked
  `/migrate` has the new schema + migration. Verified: boot migrate clean, **seed completes**, table
  survives reboot, `db:generate` reports "No schema changes" (snapshot in sync).
  → **Workflow for Phases 03/04/05:** add table to `schema.ts` → `npm run db:generate` (now produces a
  CLEAN single-feature migration, no drift) → apply with `db:migrate` → **rebuild the app+telegram
  images** (`docker compose build app telegram`) so baked `/migrate` ships the new migration, then
  `docker compose up -d`. Prod path (`RUN_DB_PUSH=true`) also picks it up from the rebuilt schema.
- **F1 (Phase 03) merge:** NO merge into existing lead. Identify-in-place ONLY. Identification requires
  name OR email — if neither is provided, DO NOT persist a lead (anonymous visitor stays ephemeral, not
  saved). Reuse `is-identified-lead.ts` gate + existing `promoteAnonymousVisitor`.
- **F4c (Phase 02) scope:** search BOTH lead-DM Telegram threads AND agency group topics, tag each
  result with its source. Also fix the cross-agency leak in `search_messages` (add agency scoping).
- **F4d (Phase 04) erasure:** HARD-DELETE with no trace (CNIL-favored) — wipe `long_term_memory`,
  `persona`, messages; keep only minimal audit log. Extends existing `delete_lead`.
- **F4a (Phase 05) consent:** delivery layer does NOT gate on marketing consent — agent/main_assistant
  owns that decision at schedule time. Keep delivery simple.
- **F4a (Phase 05) scheduler HOST — CORRECTION to research report:** prod compose has only `db` + `app`
  (no telegram poller; prod uses webhook `app/api/telegram`). The ONLY always-on prod process is the
  Next.js app server. Host the DB-polled scheduler in `instrumentation.ts` `register()` hook (runs in
  dev + prod), gated behind env `RUN_SCHEDULER` (default off; enable on exactly one app instance),
  with `FOR UPDATE SKIP LOCKED` for multi-instance safety. Do NOT host it in `scripts/telegram-dev.ts`.
- **OQ-01-1 placeholders:** template placeholders = `{{name}}`, `{{email}}`, `{{listing_title}}`,
  `{{agency_name}}`. Unresolved placeholder → leave literal + warn (do not block send).

See OPEN QUESTIONS at the end of each phase (those superseded by the above are resolved).
