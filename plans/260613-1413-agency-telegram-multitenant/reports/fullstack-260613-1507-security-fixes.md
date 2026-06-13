# Security Fix Report — fullstack-260613-1507-security-fixes

## Findings & Fixes

---

### C1 — Spoofable x-agency-id header (CRITICAL)

**File:** `middleware.ts` line 37  
**Fix:** Added `headers.delete('x-agency-id')` immediately after cloning request headers, before the conditional `headers.set`. Client-supplied value is now unconditionally stripped on every request. Server-side resolution result (or nothing) is the only source of truth.

```diff
  const headers = new Headers(request.headers);
+ // Always strip any client-supplied x-agency-id — must come from server-side resolution only.
+ headers.delete('x-agency-id');
  if (agencyId) {
    headers.set('x-agency-id', agencyId);
  }
```

---

### C2 — Cross-tenant IDOR in admin operator chat (CRITICAL)

**File:** `app/api/admin/operator/chat/route.ts`  
**Fix (GET ~line 27):** After `getLeadById(leadId)`, added `lead.agency_id !== agencyId` check. Changed `getOrCreateLeadOperator(leadId, lead.agency_id)` → `getOrCreateLeadOperator(leadId, agencyId)` so lead's own agency_id can never be used to bypass the check.

**Fix (POST ~line 88):** Same pattern — checks `lead.agency_id !== admin.agency_id`, uses `admin.agency_id` for `getOrCreateLeadOperator`.

Both branches return `404 not_found` when the lead belongs to a different agency.

---

### C3 — Cross-tenant IDOR in admin actions (CRITICAL)

**File:** `app/api/admin/actions/route.ts`  
**Fix:** Changed `resolveVisitorThread(conversationId: string)` signature to `resolveVisitorThread(conversationId: string, agencyId: string)`, added `|| conv.agency_id !== agencyId` to the null guard. All three cases (`takeover`, `release`, `send_reply`) now pass `agencyId` from `admin.agency_id`. A request for a foreign agency's conversation resolves to `null` → `notFound()`.

---

### I2 — IPv6 dev-host bug (IMPORTANT)

**File:** `lib/agency-context.ts` line 28  
**Fix:** Replaced `host.split(':')[0] ?? host` with a branch that handles IPv6 bracket notation:

```ts
const hostname = host.startsWith('[')
  ? host.slice(0, host.indexOf(']') + 1)
  : (host.split(':')[0] ?? host);
```

`[::1]:3000` now yields `[::1]`, which is in `DEV_HOSTS`.

---

### I1 — Guard sweep (IMPORTANT)

Scanned every route under `app/api/admin/*` that loads a lead or conversation by client-supplied ID.

| Route | Path | Action | Result |
|---|---|---|---|
| `data/route.ts` | GET | `listIdentifiedLeads(agencyId)` — already agency-scoped | **Already safe** |
| `assistant/route.ts` | GET/POST | `getOrCreateMainAssistant(admin.id, admin.agency_id)` — scoped by both admin id + agency | **Already safe** |
| `link-telegram/route.ts` | POST | `issueAgencyTelegramLinkToken(admin.agency_id)` — no external ID input | **Already safe** |
| `upload-listing-image/route.ts` | POST | File upload only, no resource lookup | **Already safe** |
| `threads/route.ts` (conv branch) | GET | `getConversation(conversationId)` — **no agency check** | **GUARDED** — added `conv.agency_id !== admin.agency_id → 404` |
| `threads/route.ts` (leadId branch) | GET | `getLeadById(leadId)` — **no agency check** | **GUARDED** — added `lead.agency_id !== admin.agency_id → 404` |
| `conversation/route.ts` | GET | `getLeadById(leadId)`, `requireAdmin()` result discarded | **GUARDED** — captured admin, added `lead.agency_id !== admin.agency_id → 404` |
| `stream/route.ts` | GET (SSE) | `getConversation(conversationId)` — **no agency check** | **GUARDED** — added `conv.agency_id !== adminAgencyId → 404` (new hole, see below) |
| `operator/chat/route.ts` | GET/POST | Fixed under C2 above | **GUARDED** |
| `actions/route.ts` | POST | `update_listing`/`delete_listing` — unscoped by ID | **GUARDED** — fetch listing, check `agency_id` before mutating |
| `actions/route.ts` | POST | `toggle_rule`/`delete_rule` — unscoped by ID | **GUARDED** — added `getHandoffRule` helper, check `agency_id` before mutating |

---

### New hole found during sweep — stream cross-tenant read

**File:** `app/api/admin/stream/route.ts`  
**Severity:** CRITICAL (read-only, but admin A could subscribe to live message stream of agency B's conversation)  
**Fix:** Captured `admin` from `requireAdmin()`, added `conv.agency_id !== adminAgencyId → 404` guard before opening the SSE stream.

---

### db helper added

`lib/db/handoff.ts` — added `getHandoffRule(id: string): Promise<HandoffRule | null>` (4 lines). Required for ownership check in actions route without modifying shared delete/toggle signatures. No behaviour change to existing helpers.

---

## Test Results

| Check | Result |
|---|---|
| `npm run typecheck` | PASS (clean) |
| `npm run test` | PASS — 128/128 |
| `npm run test:agent` | PASS — 226/226 |

---

**Status:** DONE  
**Summary:** Fixed C1/C2/C3/I2/I1 as specified. Found and fixed one additional cross-tenant read hole in `stream/route.ts`. Added ownership guards to listing and rule mutations in `actions/route.ts`. Typecheck clean, all 354 tests green.  
**Concerns/Blockers:** None.
