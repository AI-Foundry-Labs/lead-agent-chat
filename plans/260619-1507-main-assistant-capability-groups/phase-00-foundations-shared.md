# Phase 00 — Foundations: shared DB + tool wiring

## Context Links
- Overview: [plan.md](plan.md)
- Tool barrel: `lib/agent/tools/main-assistant/index.ts`
- Schema: `lib/db/schema.ts`; DB barrel: `lib/db/index.ts`; client: `lib/db/client.ts`
- System prompt: `lib/agent/prompts/main-assistant-prompt.ts`

## Overview
- **Priority:** P1 (blocks all other phases)
- **Status:** pending
- Establish shared conventions so later phases don't duplicate wiring: how new tables get
  added/migrated, how new tool files register in the barrel, prompt-edit ownership.

## Key Insights
- `index.ts` `buildMainAssistantTools` spreads per-domain builders. New file = one import + one spread.
- `lib/db/client.ts` exports tables; `lib/db/index.ts` re-exports tables + domain helpers. New table
  must be added in BOTH places.
- README says project uses `db:push` (no SQL migration files), but task says `db:generate`+`db:migrate`.
  **Must confirm with user** (OQ-00-1) before any schema work.
- No date/tz library in package.json — Phase 05 will add an `Intl`-based helper, not a dependency.

## Requirements
- **Functional:** A documented, repeatable pattern for: (1) add table → schema + client + index + domain
  helper file; (2) add tool file → register in barrel; (3) append capability note to system prompt.
- **Non-functional:** No new npm deps. Files <200 LOC. kebab-case.

## Architecture
Data flow per new tool: agent turn → `buildMainAssistantTools(ctx, adminId, ...)` → domain builder
returns `{ tool_name: tool({...}) }` → tool `execute()` reads/writes via `lib/db` helpers scoped by
`ctx.config.agency_id` → returns plain JSON to model.

## Related Code Files
**Modify:**
- `lib/agent/tools/main-assistant/index.ts` — import + spread each new builder (one edit per later phase).
- `lib/db/schema.ts`, `lib/db/client.ts`, `lib/db/index.ts` — table defs + exports (per later phase).
- `lib/agent/prompts/main-assistant-prompt.ts` — capability notes (per later phase).

**Create (in later phases, listed here for migration batching):**
- `message_templates`, `lead_consents`, `audit_log`, `scheduled_messages` tables.

## Implementation Steps
1. Confirm migration command with user (`db:push` vs `db:generate`+`db:migrate`).
2. Decide migration batching: one push/generate per phase (recommended) vs one big batch at end.
3. Record the agreed pattern in this file's checklist; later phases reference it.
4. No code shipped in this phase beyond documentation of the pattern (it is a setup/contract phase).

## Todo List
- [ ] Resolve OQ-00-1 (migration command) with user
- [ ] Confirm per-phase migration batching strategy
- [ ] Confirm no new npm dependency is acceptable for all phases

## Success Criteria
- Migration command + batching decided and recorded.
- Each later phase can add a table + tool file with zero ambiguity.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Wrong migration tool corrupts existing data | Low×High | Resolve OQ-00-1 first; test on dev DB; `db:push` is current README truth |
| Barrel merge conflicts if phases run in parallel | Med×Low | Phases sequential per ordering; single owner of `index.ts` per phase |

## Security / GDPR Considerations
- None new here; sets up the agency_id-scoping convention enforced by every later phase.

## Next Steps
- Unblocks Phases 01–05.

## OPEN QUESTIONS
- **OQ-00-1:** Migration mechanism — README says `db:push` (no SQL files); task brief says
  `db:generate`+`db:migrate`. Which is authoritative? This affects every phase.
