# Phase 03 Implementation Report — delete_listing + bulk_import_listings

## Phase
- Phase: phase-03-delete-and-bulk-import
- Plan: plans/260613-1752-master-agent-config-topic/
- Status: completed

## Files Modified

| File | Change |
|------|--------|
| `lib/agent/tools/main-assistant-tools.ts` | Added `deleteListing` import, `delete_listing` tool, `bulk_import_listings` tool |
| `lib/agent/prompts/main-assistant-prompt.ts` | Added 2 tool hints in [TOOLS — WHEN TO USE] section |

## Tasks Completed

- [x] `delete_listing` tool + tenant guard (`existing.agency_id !== ctx.config.agency_id` → `{error:'forbidden'}`)
- [x] `listingInputSchema` reused via `listingSchema.omit({ agency_id: true })` (no redefinition)
- [x] `bulk_import_listings` (cap 50, per-item try/catch, `{created, failed, total}`)
- [x] Prompt updated: `delete_listing`, `bulk_import_listings`, one-line hint "khi admin paste nhiều BĐS → bulk_import_listings"
- [x] `broadcastAgencyDataChanged` called after delete and after bulk if `created.length > 0`

## Implementation Notes

**delete_listing:**
- Guard order: `getListing` → not found → `{ error: 'listing_not_found' }` → agency mismatch → `{ error: 'forbidden' }` → delete → broadcast → `{ ok: true, id }`
- Matches exact pattern of `update_listing` / `delete_handoff_rule`

**bulk_import_listings:**
- `image_url: item.image_url ?? null` normalizes undefined → null (same as `create_listing`)
- Per-item catch: pushes `{ index, id?, reason: err.message }` to `failed[]`; does not abort batch
- `broadcastAgencyDataChanged` only called when ≥1 listing created (avoids spurious refresh on all-fail batch)
- Input cap: `z.array(...).min(1).max(50)` — Zod validates before execute

## Tests Status

- Type check: **pass** (tsc --noEmit, 0 errors)
- Unit tests: **pass** (128/128)
- Agent tests: **pass** (226/226)
- No test fixtures needed updating (no test asserts tool count for main-assistant tools)

## Issues Encountered

None.

## Docs Impact

Minor — prompt updated inline. No separate docs update required.

---

**Status:** DONE
**Summary:** `delete_listing` (with tenant guard) and `bulk_import_listings` (per-item error handling, cap 50) added to `buildMainAssistantTools`. Prompt updated. All 354 tests green.
**Unresolved questions:** None.
