# Plan: Admin Preferred Lang + Lead Persona

## Status: PENDING APPROVAL

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | DB Schema + Migration | ⏳ |
| 2 | Types + DB Functions | ⏳ |
| 3 | Admin Login Lang Cookie | ⏳ |
| 4 | Lead Persona in Prompt + Agent Tool | ⏳ |
| 5 | UI: Persona Textarea + API | ⏳ |

---

## Phase 1: DB Schema

**Files:** `lib/db/schema.ts`

- `admins` table: add `preferred_lang varchar(2) default 'fr' not null`
- `leads` table: add `persona text` (nullable)

Run: `npm run db:push`

Then: `UPDATE admins SET preferred_lang = 'en' WHERE email = 'admin@gmail.com';`

---

## Phase 2: Types + DB Functions

**Files:** `lib/types.ts`, `lib/db/leads.ts`

- `Lead` type: add `persona: string | null`
- `updateLead` patch: add `persona: string | null`
- `rowToLead`: map `persona`

---

## Phase 3: Admin Login Lang Cookie

**Files:** `app/api/auth/admin/login/route.ts`, `app/admin/login/page.tsx`

- Login API: return `preferred_lang` in JSON response
- Login page: after `res.ok`, set `lang` cookie = `preferred_lang` before `router.push`

---

## Phase 4: Persona Prompt Block + Agent Tool

**Files:** `lib/agent/prompts.ts`, `lib/agent/tools/lead-tools.ts`

### `prompts.ts`
- New `personaBlock(lead)` fn: if `lead.persona` exists, inject `[LEAD PERSONA]\n{persona}`
- Add `persona` block into `buildLeadSystemPrompt` (after `longTermMemoryBlock`)

### `lead-tools.ts`
- New tool `update_lead_persona`:
  - description: "Update or replace the lead's freeform persona text. Use after gathering enough context to write a concise profile summary (1–5 sentences). Captures identity, intent, preferences, and notes."
  - inputSchema: `{ persona: z.string().max(2000) }`
  - execute: `updateLead(lead.id, { persona })`

---

## Phase 5: UI + API

**Files:**
- `app/api/admin/lead/[id]/persona/route.ts` (NEW)
- `components/admin/lead-memory-panel.tsx`
- `components/admin/conversations-panel.tsx`
- `lib/i18n.ts`

### API route
- `PATCH /api/admin/lead/[id]/persona` — body: `{ persona: string }`
- Validates admin session, updates lead persona

### `lead-memory-panel.tsx`
- Add `persona?: string | null` + `leadId?: string` props
- Add collapsible "Persona" section with `<textarea>` (controlled)
- Auto-save on blur via PATCH call

### `conversations-panel.tsx`
- Pass `persona={detail.lead?.persona}` and `leadId={detail.lead?.id}` to `LeadMemoryPanel`

### `lib/i18n.ts`
- Add `conv_persona: 'Persona'` / `'Persona'` to fr/en dicts
