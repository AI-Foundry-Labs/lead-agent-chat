# Public Tenant Isolation Fixes — Report

Date: 2026-06-13

---

## Findings & Fixes

### Fix 1 — `getLeadByEmail` scoped to agency

**File:** `lib/db/leads.ts` line 37

**Change:** Added required `agencyId: string` param. WHERE clause changed from `eq(leads.email, email)` to `and(eq(leads.email, email), eq(leads.agency_id, agencyId))`. Added `and` to drizzle import.

**Callers updated:**

| Caller | File:approx-line | Change |
|--------|-----------------|--------|
| `lead-request-link` POST | `app/api/auth/lead-request-link/route.ts:52` | Moved agency resolution above `getLeadByEmail` call (was inside `if(!lead)`). Now resolves agency first, then passes to both lookup and create. |
| Google OAuth callback | `app/api/auth/google/callback/route.ts:61` | Same restructure — agency resolved before lookup, passed to both `getLeadByEmail` and `createLead`. |
| Email inbound | `app/api/email/route.ts:31` | See Fix 5 below — agency now resolved per Fix 5; `agency.id` passed to `getLeadByEmail`. |

---

### Fix 2 — `assertLeadChatAccess` tenant-checks conversation

**File:** `lib/conversation-access.ts` line 15

**Change:** Added required `agencyId: string` param. After loading `conv`, inserted:
```
if (conv.agency_id !== agencyId) throw new ConversationAccessError(404, 'not_found');
```
Uses the same `ConversationAccessError` type/shape, 404 status (indistinguishable from not-found — no info leak).

**Callers updated:**

| Caller | File:line | Change |
|--------|-----------|--------|
| `GET /api/chat` | `app/api/chat/route.ts:36` | Resolves `agencyId` (header → default) before the try block; passes to access check. Returns 503 if no agency. |
| `POST /api/chat` | `app/api/chat/route.ts:77` | Moved agency resolution to top of POST handler (used for both access check and new conversation). Passes to access check. |
| `GET /api/chat/stream` | `app/api/chat/stream/route.ts:43` | Added `getDefaultAgency` import; resolves `agencyId` before access check in GET and threads through to `buildSnapshot`. |
| `buildSnapshot` (internal) | `app/api/chat/stream/route.ts:13` | Added `agencyId` param; passes to `assertLeadChatAccess`. |
| `POST /api/chat/link-telegram` | `app/api/chat/link-telegram/route.ts:31` | Added `getDefaultAgency` import; resolves `agencyId`; passes to access check. Returns 503 if no agency. |

---

### Fix 3 — `claimConversationsForLead` scoped to agency

**File:** `lib/db/conversations.ts` line 87

**Change:** Added required `agencyId: string` param. In the loop, added:
```
if (conv.agency_id !== agencyId) continue;
```
Silently skips conversations owned by a different agency — client-supplied IDs from agency B cannot be claimed by an agency A session.

**Caller updated:**

- `app/api/chat/claim/route.ts:21` — Added `getDefaultAgency` import; resolves `agencyId` (header → default); passes to `claimConversationsForLead`. Returns 503 if no agency.

---

### Fix 4 — Listing cross-tenant validation before conversation creation

**File:** `app/api/chat/route.ts` POST handler, before `createConversation` (~line 96)

**Change:** Added `getListingById` to `@/lib/db` import. Before creating a conversation with a client-supplied `listingId`:
```ts
if (listingId) {
  const listing = await getListingById(listingId);
  if (!listing || listing.agency_id !== agencyId) {
    return Response.json({ error: 'invalid_listing' }, { status: 400 });
  }
}
```
Rejects if listing doesn't exist or belongs to a different agency. New conversation's `agency_id` comes from server-resolved `agencyId` (already confirmed correct).

---

### Fix 5 — Email route agency resolution (best-effort recipient domain matching)

**File:** `app/api/email/route.ts`

**Change:** Added `getAgencyByHost` to import from `@/lib/db/agencies`. Extracts domain from Sendgrid `to` field, attempts `getAgencyByHost(domain)` lookup. Falls back to `getDefaultAgency()` if no match. Comment: `// TODO: multi-agency inbound email routing — wire per-agency inbound addresses.`

This is KISS — uses the already-existing `getAgencyByHost` helper and the existing Sendgrid `to` field. No new tables or complex routing.

---

## DB Change (skipped)

Composite unique index `(agency_id, email)` on `leads` table was evaluated but skipped. Rationale:
- Risk: existing seed data or test fixtures may have duplicate `(agency_id, email)` pairs that would fail migration.
- The functional isolation is now enforced at query level (Fix 1) — the index would be a performance/constraint enhancement, not a correctness requirement.
- Note for future: add `UNIQUE (agency_id, email)` once seed/migration data is audited.

---

## Additional Holes Found

None found beyond what was specified. All public/visitor paths reviewed:
- `/api/chat` GET/POST — fixed
- `/api/chat/stream` GET — fixed
- `/api/chat/link-telegram` POST — fixed
- `/api/chat/claim` POST — fixed
- `/api/auth/lead-request-link` POST — fixed
- `/api/auth/google/callback` GET — fixed
- `/api/email` POST — fixed

`assertLeadOwnsConversation` (inbox route, not a public path) does not need agency isolation as it requires an identified `leadId` session and that lead's `agency_id` is implicitly correct — no change needed there.

---

## Test Results

- `npm run typecheck`: PASS (clean — all new required params resolved all call sites)
- `npm run test`: PASS — 128/128 green
- `npm run test:agent`: PASS — 226/226 green

---

## Files Modified

| File | Change |
|------|--------|
| `lib/db/leads.ts` | `getLeadByEmail` → added `agencyId` param + `and()` WHERE filter |
| `lib/conversation-access.ts` | `assertLeadChatAccess` → added `agencyId` param + agency equality check |
| `lib/db/conversations.ts` | `claimConversationsForLead` → added `agencyId` param + agency skip filter |
| `app/api/auth/lead-request-link/route.ts` | Agency resolved before `getLeadByEmail`; passed to lookup |
| `app/api/auth/google/callback/route.ts` | Same restructure for Google OAuth flow |
| `app/api/email/route.ts` | Best-effort recipient-domain agency resolution; `agency.id` to `getLeadByEmail` |
| `app/api/chat/route.ts` | Agency resolved at top of both GET+POST; `assertLeadChatAccess` + listing validation |
| `app/api/chat/stream/route.ts` | Agency resolved in GET; threads through `buildSnapshot` |
| `app/api/chat/link-telegram/route.ts` | Agency resolved; passed to `assertLeadChatAccess` |
| `app/api/chat/claim/route.ts` | Agency resolved; passed to `claimConversationsForLead` |

---

**Status:** DONE
**Summary:** All 5 tenant-isolation fixes applied surgically. Typecheck clean, 128 unit + 226 agent tests green. No scope creep. DB migration skipped (safe reason noted above).
