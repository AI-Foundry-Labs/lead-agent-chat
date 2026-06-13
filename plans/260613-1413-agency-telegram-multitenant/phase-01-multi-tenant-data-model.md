# Phase 01 — Multi-Tenant Data Model

## Overview
- **Priority:** Critical (foundation for all later phases)
- **Status:** completed
- **Description:** Introduce `agencies` as the tenant root and thread `agency_id` through core tables. Backfill existing single-tenant data into one default agency.

## Key Insights
- Today there is **no tenant concept**: `agency_config` is a single row, `admins`/`leads`/`listings`/`handoff_rules` are global.
- Telegram binding currently lives on `admins.telegram_user_id` (per-admin DM). New model binds Telegram at the **agency** level (group), not per admin.
- Every read path must be scoped by `agency_id` or tenants leak into each other → this is the highest-risk phase.

## Requirements
**Functional**
- New `agencies` table (tenant root).
- `agency_id` FK on: `admins`, `leads`, `conversations`, `listings`, `handoff_rules`, `agency_config`, `viewing_slots`.
- **Lead→agency assignment (red-team C3 — was missing):** every lead must resolve to an agency at creation. **Host-first rule (validation decision):**
  1. **Request Host/subdomain → agency** (primary; true multi-tenant, e.g. `foncia.app.com`). Resolved in middleware from the `Host` header.
  2. `listings.agency_id` → consistency check (if visit has a listing, assert it belongs to the host's agency; mismatch = log + trust host).
  3. Default agency → last-resort fallback only.
  `createLead` / `ensureLeadForConversation` MUST take/derive `agency_id`; no lead row without one.
- **Domain mapping:** `agencies` needs a way to map hosts → agency. Add `agencies.primary_host` (unique) and/or an `agency_domains` table for multiple custom domains. Middleware (`middleware.ts`) reads Host, resolves agency, passes `agency_id` down (header/context).
- Backfill: create one "default" agency, point all existing rows at it.
- All query helpers in `lib/db/*` accept/enforce an `agency_id` scope.

**Non-functional**
- Migration must be safe on existing seeded data (no data loss).
- `agency_id` NOT NULL after backfill (add nullable → backfill → set not-null).

## Architecture
```
agencies (id, name, slug, telegram_group_chat_id, telegram_topics_enabled, created_at)
  ├─ admins.agency_id           (FK, cascade)
  ├─ leads.agency_id            (FK)
  ├─ listings.agency_id         (FK)
  ├─ conversations.agency_id    (FK)   ← denormalized for fast scoped queries
  ├─ handoff_rules.agency_id    (FK)
  ├─ agency_config.agency_id    (FK, unique → 1 config per agency)
  └─ viewing_slots.agency_id    (FK)
```
- `agency_config` becomes 1-row-per-agency (drop implicit singleton).
- Resolve agency context: web request → admin session → `admins.agency_id`; lead → `leads.agency_id`; Telegram → `agencies.telegram_group_chat_id` lookup.

## Related Code Files
**Modify**
- `lib/db/schema.ts` — add `agencies`, add `agency_id` columns + indexes.
- `lib/db/client.ts` / `lib/db/index.ts` — export `agencies`.
- `lib/db/conversations.ts`, `lib/db/leads.ts` (if present), `lib/db/admins`/`telegram-links.ts`, `lib/db/*` query helpers — add `agency_id` params/filters.
- `scripts/seed.ts` — seed default agency, attach existing seed rows.
- `lib/agent/run.ts` — thread agency context where leads/handoff rules are read.

**Create**
- `lib/db/agencies.ts` — `getAgencyById`, `getAgencyByHost`, `getAgencyByTelegramGroup`, `getDefaultAgency`, `createAgency`.
- `lib/agency-context.ts` — `resolveAgencyForVisit({ host, listingId })` implementing the host-first rule above.
- `middleware.ts` (Next.js) — read `Host` header → resolve agency → propagate `agency_id` (request header / context) to routes.

## Implementation Steps
1. Add `agencies` table to schema (id, name, slug unique, `telegram_group_chat_id` nullable unique, `telegram_topics_enabled` bool, timestamps).
2. Add `agency_id uuid` (nullable first) + index to each core table listed above.
3. **Real migration (red-team I3):** write an explicit drizzle migration (NOT seed) that inserts the default agency, runs `UPDATE ... SET agency_id = <default>` on every table, verifies zero NULLs, THEN sets NOT NULL. `scripts/seed.ts` only seeds fresh DBs.
4. Flip `agency_id` to NOT NULL in schema (after migration backfill verified).
5. Add `agencies.primary_host` (unique) + optional `agency_domains` table; implement `middleware.ts` Host→agency resolution; implement `resolveAgencyForVisit` (host-first) and wire into `createLead` / `ensureLeadForConversation` so every new lead gets an `agency_id`.
6. Make `agency_config` unique on `agency_id`; update `getAgencyConfig` to take `agency_id`.
7. Update every `lib/db/*` helper that reads leads/conversations/handoff_rules/config to require `agency_id`.
8. `npm run typecheck` — fix all call sites the new required param surfaces.

## Note on `conversations.agency_id` (red-team I2)
Denormalized from `leads.agency_id` for fast scoped queries. Drift risk on lead reassignment → treat lead creation as the **single writer**; if a lead is ever reassigned, update both in one tx. Acceptable trade-off vs joining on every conversation query.

## Todo List
- [x] `agencies` table + `lib/db/agencies.ts`
- [x] `agency_id` columns + indexes on 7 tables
- [x] Backfill default agency in seed + migration note
- [x] NOT NULL constraints after backfill
- [x] `agency_config` per-agency uniqueness
- [x] Scope all `lib/db/*` read helpers by `agency_id`
- [x] `npm run typecheck` clean

## Success Criteria
- `db:push` + `db:seed` run clean; all existing rows belong to default agency.
- No query returns cross-agency rows (spot-check with a 2nd seeded agency).
- `npm run typecheck` passes.

## Risk Assessment
- **High:** missing an `agency_id` filter on a read path → tenant data leak. Mitigation: grep every `db.select(...).from(leads|conversations|handoff_rules|agency_config)` call site; Phase 06 adds a cross-tenant isolation test.
- **Medium:** NOT NULL flip fails if backfill incomplete. Mitigation: nullable → backfill → verify count → set not-null.

## Security Considerations
- Agency isolation is now an **authorization boundary**. Admin session must resolve to its `agency_id`; never trust a client-supplied agency id.

## Next Steps
- Phase 02 uses `agencies.telegram_group_chat_id` for group binding.
