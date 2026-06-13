# Phase 06 — Tests, Migration Safety, Docs

## Overview
- **Priority:** High
- **Status:** completed
- **Description:** Lock the design with tests (tenant isolation, topic routing, echo-loop, handoff/takeover), verify migration safety on existing data, update docs.

## Key Insights
- The two highest-risk invariants are **tenant isolation** (Phase 01) and **no echo loop / no wrong-channel send** (Phase 04–05). Tests must target these explicitly.
- Existing eval harness lives in `eval_harness/` — extend it, don't invent a new framework.

## Requirements
**Functional (tests)**
- Tenant isolation: agency A query never returns agency B rows (leads, conversations, handoff_rules, config).
- Group message routing: (chatId, threadId) → correct handler; unknown thread → ignored.
- Echo filter: bot-authored Topic 1 posts are not re-ingested as takeover.
- Operator topic: Topic 2 message → operator reply stays in Topic 2, never dispatched to customer.
- Handoff: rule fires → agency-scoped notify only; mode flips manual.
- Takeover sync: Telegram Topic 1 admin msg → customer channel + web broadcast; web msg → Topic 1.
- Idempotent topic creation under concurrent calls.
- Lead→agency assignment (host-first): `Host` header → agency via middleware; listing mismatch logged not trusted; default fallback (red-team C3 + validation).
- Send-queue throttle: bursts stay under 20 msg/min/group; mirror messages drop before handoff/takeover under pressure (red-team C1).
- Sender→admin: unmapped Telegram group sender → operator/takeover rejected, no fallback (red-team C2).
- Registered-group guard: update from unknown `chat.id` rejected (red-team I4).

**Non-functional**
- `npm run typecheck`, `npm run build`, `db:push` + `db:seed` clean on seeded data.

## Related Code Files
**Modify/Create**
- `eval_harness/unit/*` — tenant-isolation, group-routing, echo-filter, takeover-sync tests.
- `eval_harness/smoke/api-endpoints.test.ts` — agency-scoped link endpoint.
- `scripts/seed.ts` — second agency for isolation tests.
- Docs: `docs/system-architecture.md`, `docs/codebase-summary.md`, `docs/project-changelog.md`, `README.md` (Telegram section now agency-group-based), `docs/project-roadmap.md`.

## Implementation Steps
1. Add second agency + cross-tenant fixtures in seed.
2. Unit tests for tenant isolation on each scoped helper.
3. Pure-router tests for `route-group-message.ts` (Topic1/Topic2/General/unknown).
4. Echo-loop + bot-filter test.
5. Operator-topic containment test (no customer dispatch).
6. Handoff + dual-takeover integration tests (mock Telegram send).
7. Migration safety: run `db:push` against a copy of seeded data; assert all rows backfilled with `agency_id`, NOT NULL holds.
8. Update docs + changelog + roadmap; README Telegram flow rewrite.
9. Full gate: `typecheck` + `build` + targeted eval tests green.

## Todo List
- [x] Second-agency fixtures
- [x] Tenant-isolation unit tests
- [x] Group-routing tests
- [x] Echo-filter test
- [x] Operator-topic containment test
- [x] Handoff + dual-takeover tests
- [x] Migration safety verification
- [x] Docs + changelog + roadmap + README
- [x] typecheck + build + tests green

## Success Criteria
- All targeted tests pass; no cross-tenant leakage; no echo loop; copilot never messages customers.
- `db:push`+`db:seed` clean; existing data fully backfilled.
- Docs reflect agency-group Telegram model.

## Risk Assessment
- **Medium:** integration tests need Telegram mocking. Mitigation: reuse existing mock fallbacks (`telegramConfigured()` path), assert on dispatch calls.

## Security Considerations
- Tenant-isolation test is the regression guard for the authorization boundary introduced in Phase 01.

## Next Steps
- Follow-up (out of scope now): auto-archive aged topics; per-agency bot branding.
