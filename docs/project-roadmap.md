# Project Roadmap

## Current Status

**MVP Complete (2026-06-13):** All six plan phases shipped.

## Completed Milestones

| Phase | Milestone | Status | Shipped |
|-------|-----------|--------|---------|
| 01 | Multi-tenant data model + lead→agency assignment | ✅ DONE | 2026-06-13 |
| 02 | Agency Telegram group linking + sender→admin resolver | ✅ DONE | 2026-06-13 |
| 03 | Per-lead forum topics (Conversation + Assistant) | ✅ DONE | 2026-06-13 |
| 04 | Two-way sync + routing + send throttle (20 msg/min) | ✅ DONE | 2026-06-13 |
| 05 | Handoff + dual takeover (web + Telegram) | ✅ DONE | 2026-06-13 |
| 06 | Tests, migration safety, docs | ✅ DONE | 2026-06-13 |

## Key Achievements (June 13, 2026)

- ✅ Multi-tenant architecture: agencies table + agency_id FK across core tables.
- ✅ Agency → host/subdomain resolver with fallback.
- ✅ Telegram agency control surface: one global bot, per-agency supergroups.
- ✅ Per-lead two-topic model: Conversation (lead↔agent mirror) + Assistant (copilot, internal).
- ✅ Per-group send queue with 20 msg/min throttle + drop policy (mirrors droppable, critical never).
- ✅ Dual takeover: mode set from web + Telegram (single source of truth).
- ✅ Handoff notifications to agency group.
- ✅ Kept existing visitor lead-DM Telegram flow (not removed).
- ✅ 4 critical IDOR fixes + 2 important improvements.
- ✅ Full test coverage (128 + 226 = 354 tests passing).

## Future Work (Not Scheduled)

### High Priority

- **Auto-archive aged topics:** Topics for closed conversations auto-archive after N days. Noted in plan (YAGNI v1).
- **Redis-backed send queue:** Upgrade from in-memory for multi-instance deployments.
- **Per-agency separate bots:** If lead-facing bot identity becomes critical (revisit only if needed).

### Medium Priority

- **Billing & agency self-signup:** Self-service onboarding + usage tracking.
- **RBAC beyond admin auth:** Fine-grained roles (e.g., team lead vs. support).
- **Email inbound integration:** Extend agent loop to email channel.

### Low Priority

- **Webhook redundancy:** Multi-endpoint failover for critical Telegram events.
- **Conversation search & analytics:** Lead history across agencies.

---

## Version History

- **2026-06-13:** MVP GA — multi-tenant + agency-scoped Telegram.
- Earlier: Chat-first agentic redesign from lead-qualification-agent.
