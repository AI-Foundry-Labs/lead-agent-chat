# Phase 04 — Consent / GDPR audit log (F4d)

## Context Links
- Overview: [plan.md](plan.md) · Foundations: [phase-00](phase-00-foundations-shared.md)
- Research: `plans/reports/researcher-260619-1508-gdpr-consent-audit-design.md`
- Sensitive tool bodies: `lib/agent/tools/main-assistant/leads.ts`, `messaging.ts`,
  `visitor-pool.ts` (Phase 03), operator tools.
- Existing erasure: `delete_lead` in `leads.ts`.

## Overview
- **Priority:** P2 · **Status:** pending · **Risk:** Medium
- French market (CNIL): record per-lead data-processing/marketing consent + an audit trail of
  who accessed/modified a lead. Minimal, defensible design. Done after F1 so the new pool/identify
  tools also get audited.

## Key Insights
- Two new tables; one DRY helper `recordAudit()` called from tool `execute()` bodies (NOT scattered).
- Consent = append-only rows (withdrawal = new row granted=false), preserves immutable history.
- Log: sensitive READS (`get_lead_detail`) + ALL WRITES (update/qualify/delete/message/consent/identify/merge).
  Skip noisy list/search reads.
- Erasure (`delete_lead`) already cascades conversations+topics — extend to also delete `lead_consents`
  + emit audit `lead_erasure_executed` BEFORE the row vanishes (or write to an agency-scoped, lead-id-only
  audit row that survives erasure — see OQ-04-2).

## Requirements
**Functional:**
- Consent: `set_consent(lead_id, consent_type, granted, source?)`, `view_consent_status(lead_id)`.
- Audit: `view_audit_history(lead_id, limit?)`; automatic `recordAudit` on sensitive ops.
- GDPR rights: `export_lead_data(lead_id)` (Art.15 access — JSON bundle); erasure reuses `delete_lead`.
**Non-functional:** agency-scoped; helper <60 LOC; append-only consent; audit write must never throw
into the turn (best-effort, like long-term-memory writes).

## Architecture
- `lead_consents`: `id, agency_id, lead_id, consent_type ('data_processing'|'marketing'|'phone_contact'),
  granted bool, source varchar, recorded_by uuid?, recorded_at timestamptz, notes text?`.
  Current state = latest row per (lead, type).
- `audit_log`: `id, agency_id, admin_id?, actor_type ('admin'|'agent'|'system'), action varchar,
  target_lead_id uuid?, details jsonb?, timestamp timestamptz`. Action = string (extensible, no enum churn).
- `recordAudit(ctx, { action, target_lead_id?, admin_id?, actor_type?, details? })` in
  `lib/db/audit-helpers.ts` — single insert, swallow errors. `ctx` provides agency_id + adminId.
- Data flow: tool execute() → does work → `await recordAudit(...)` (best-effort) → returns.
- `export_lead_data`: gather lead profile + consents + viewings + all conversation messages → return
  one JSON blob; audit `lead_data_exported`.

## Related Code Files
**Create:**
- `lib/db/schema.ts` additions: `lead_consents`, `audit_log` tables.
- `lib/db/audit-helpers.ts` — `recordAudit()` (~60 LOC).
- `lib/db/consents.ts` — consent insert + latest-per-type query (~70 LOC).
- `lib/db/audit-log.ts` — list audit by lead (~40 LOC).
- `lib/agent/tools/main-assistant/gdpr.ts` — `buildGdprTools(ctx, adminId)` (set/view consent,
  view audit, export) (~150 LOC).

**Modify:**
- `lib/db/client.ts`, `lib/db/index.ts` — exports.
- `lib/agent/tools/main-assistant/leads.ts` — add `recordAudit` to get_lead_detail (read),
  update_lead_info, record_qualification, delete_lead (erasure cascade + audit); identify/merge tools.
- `lib/agent/tools/main-assistant/messaging.ts` — `recordAudit` on send_reply, promote_draft, take_over.
- `lib/agent/tools/main-assistant/index.ts` — register `buildGdprTools`.
- `lib/agent/prompts/main-assistant-prompt.ts` — note consent + audit + export tools, GDPR posture.

## Implementation Steps
1. Add `lead_consents` + `audit_log` tables; migrate.
2. Write `recordAudit()` helper (best-effort, swallow errors).
3. Write consent + audit-log db helpers.
4. Build `buildGdprTools`: set_consent, view_consent_status, view_audit_history, export_lead_data.
5. Wire `recordAudit` into existing sensitive tool bodies (writes + get_lead_detail). Extend `delete_lead`
   to delete consents + emit erasure audit.
6. Register; prompt note.
7. typecheck/build; manual: set consent → view → withdraw → history shows both rows; export returns blob.

## Todo List
- [ ] lead_consents + audit_log tables + migrate
- [ ] recordAudit() helper
- [ ] consent + audit-log db helpers
- [ ] GDPR tools (set/view consent, view audit, export)
- [ ] wire recordAudit into writes + get_lead_detail; extend delete_lead
- [ ] register + prompt note + typecheck/build

## Success Criteria
- Every write op + get_lead_detail produces an audit row (agency-scoped). Consent set/withdraw appends
  rows; view returns latest per type. Export returns full lead bundle. Erasure deletes consents + logs.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Audit write failure breaks a turn | Med×High | recordAudit best-effort, never throws (catch+log) |
| Audit log volume / noise | Med×Low | Log writes + sensitive reads only; skip list/search |
| Erasure audit row references deleted lead | Med×Med | Keep target_lead_id as plain uuid (no FK) so audit survives erasure (OQ-04-2) |
| Inconsistent audit detail shape | Low×Low | Single helper enforces shape |

## Security / GDPR Considerations
- Legal basis / privacy-policy wording = OUT OF SCOPE (document, not code).
- Retention auto-purge = OUT OF SCOPE (flag; would need Phase 05 scheduler).
- Erasure must cascade `long_term_memory`/`persona`/messages (already via delete) + consents.
- Telegram group messages can't be remotely deleted → document as limitation.

## Next Steps
- `recordAudit` reused by Phase 05 (scheduled message creation/send).

## OPEN QUESTIONS
- **OQ-04-1:** Consent types — `data_processing | marketing | phone_contact` enough? Add `email_contact`?
- **OQ-04-2:** On erasure, should `audit_log.target_lead_id` keep the (now-deleted) lead id with no FK
  so the erasure record persists? Proposed: yes, no FK on target_lead_id.
- **OQ-04-3:** Archive `long_term_memory`/`persona` into `audit_log.details` before erasure, or true
  hard-delete with no trace? (CNIL erasure favors no trace; ops favors archive.) Proposed: hard-delete.
- **OQ-04-4:** `viewing_slots` on erasure — hard-delete vs mask `contact_email`? Proposed: hard-delete.
- **OQ-04-5:** Audit admin reads only, or also `agent`/`system`-actor reads (e.g. autonomous lead turns
  reading lead data)? Proposed: log actor_type for all but only sensitive actions.
