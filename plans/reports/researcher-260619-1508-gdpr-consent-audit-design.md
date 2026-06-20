# GDPR Consent + Audit Log Design — Lead-Agent-Chat (French Real-Estate CRM)

**Status:** DONE

**Date:** 2026-06-19 | **Scope:** Pragmatic MVP design, PLANNING ONLY (no code changes)

---

## 1. CONSENT TRACKING

### Recommended Design: Separate `lead_consents` Table

**Rationale (YAGNI/KISS):**
- Separate table avoids bloating `leads` (already 14 columns)
- Supports multi-type consent per lead (data_processing, marketing, phone_contact)
- Natural history: each row = immutable fact ("consent granted on X" / "withdrawn on Y")
- Query simplicity: `SELECT * FROM lead_consents WHERE lead_id=? ORDER BY recorded_at DESC`
- No nullable columns or enum chasing on `leads`

### `lead_consents` Table (Drizzle)

```typescript
export const lead_consents = pgTable(
  'lead_consents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    lead_id: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    
    // Enum for consent type (extensible for future)
    consent_type: varchar('consent_type', { length: 50 }).notNull(),
    // 'data_processing' (GDPR Art. 6 – processing lead contact/interest data)
    // 'marketing' (GDPR Art. 21 – email/SMS promo)
    // 'phone_contact' (lead explicitly allows phone outreach)
    
    granted: boolean('granted').notNull(),
    // true = consent given; false = consent withdrawn
    // New row per state change; never update in-place
    
    source: varchar('source', { length: 50 }).notNull(),
    // 'web_form' (implicit via chat signup)
    // 'lead_request' (lead optout via settings)
    // 'admin_manual' (admin recorded offline consent)
    // 'telegram' (withdrawal via Telegram)
    
    recorded_at: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    recorded_by: uuid('recorded_by').references(() => admins.id, { onDelete: 'set null' }),
    // null = system/lead action; uuid = admin who recorded it
    
    notes: text('notes')
    // Optional: reason for withdrawal, audit trail annotation
  },
  (t) => ({
    lead_idx: index('lead_consents_lead_idx').on(t.lead_id),
    agency_idx: index('lead_consents_agency_idx').on(t.agency_id),
    type_idx: index('lead_consents_type_idx').on(t.consent_type),
    recorded_idx: index('lead_consents_recorded_idx').on(t.recorded_at)
  })
);
```

### Consent Types (Enum Suggestion)

```typescript
export const CONSENT_TYPES = {
  DATA_PROCESSING: 'data_processing',   // GDPR Art. 6(1)(a) — storing/processing contact
  MARKETING: 'marketing',               // GDPR Art. 21 — email/SMS offers
  PHONE_CONTACT: 'phone_contact'        // Explicit opt-in for outreach calls
} as const;
```

### Withdrawal Representation

**Pattern:** Append a new row with `granted: false` — never update or delete.

Example timeline:
```
2026-06-10 14:22  data_processing=true  source=web_form  recorded_by=null
2026-06-15 09:45  marketing=true        source=web_form  recorded_by=null
2026-06-18 16:30  marketing=false       source=lead_request  recorded_by=null  notes="Lead opted out"
```

Query for **current state** of a consent type:
```sql
SELECT * FROM lead_consents 
WHERE lead_id = $1 AND consent_type = $2
ORDER BY recorded_at DESC LIMIT 1;
```

Result is immutable; withdrawal is final in audit trail.

### French CNIL Compliance (Practical Notes)

- **Legal basis:** Code assumes you have documented the "legal basis" for each consent type elsewhere (privacy policy, T&Cs) — out of scope for schema
- **Explicit opt-in for marketing:** `marketing=true` is explicitly recorded only if lead/admin confirms
- **Right to withdraw:** Captured automatically when `granted=false` is appended; no further action needed in schema
- **Record-keeping:** `recorded_at + recorded_by` supports CNIL audit requests ("prove you asked on date X")

---

## 2. AUDIT LOG

### Recommended Design: Single `audit_log` Table + `recordAudit()` Helper

**Rationale (DRY):**
- All tool executions call one helper: `recordAudit(ctx, action, target_lead_id, details)`
- No logging boilerplate scattered across 10+ tool execute() bodies
- Minimal columns (action is a string; details is jsonb for flexibility)
- Query by lead/admin/date easy; storage efficient

### `audit_log` Table (Drizzle)

```typescript
export const audit_log = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agency_id: uuid('agency_id').notNull().references(() => agencies.id),
    
    // WHO: admin_id or null if system/agent action
    admin_id: uuid('admin_id').references(() => admins.id, { onDelete: 'set null' }),
    // If admin_id is null, actor_type indicates the source
    actor_type: varchar('actor_type', { length: 20 }).default('system').notNull(),
    // 'admin' (admin_id present), 'lead' (self-service), 'agent' (AI), 'system' (automated)
    
    // WHAT: action name (enum-like, but varchar for extensibility)
    action: varchar('action', { length: 50 }).notNull(),
    // See "Logged Actions" section below
    
    // WHICH LEAD: target_lead_id
    target_lead_id: uuid('target_lead_id').references(() => leads.id, { onDelete: 'set null' }),
    // Null if action is not lead-scoped (e.g., 'admin_login')
    
    // WHEN
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    
    // WHY / CONTEXT
    details: jsonb('details').$type<Record<string, any>>().default({}).notNull()
    // { field: old_value, new_value } for updates
    // { reason: "..." } for status changes
    // { consent_type: "marketing" } for consent changes
  },
  (t) => ({
    lead_idx: index('audit_log_lead_idx').on(t.target_lead_id),
    admin_idx: index('audit_log_admin_idx').on(t.admin_id),
    agency_idx: index('audit_log_agency_idx').on(t.agency_id),
    action_idx: index('audit_log_action_idx').on(t.action),
    timestamp_idx: index('audit_log_timestamp_idx').on(t.timestamp)
  })
);
```

### `recordAudit()` Helper (Signature + Placement)

**File:** Create `lib/db/audit-helpers.ts` (~60 lines)

```typescript
import { db, audit_log } from '@/lib/db';
import type { AgentContext } from '@/lib/agent/tools/context';

export async function recordAudit(ctx: AgentContext, opts: {
  action: string;                    // e.g. 'lead_detail_viewed'
  target_lead_id?: string;           // UUID or null
  admin_id?: string | null;          // UUID of admin, or null if system
  actor_type?: 'admin' | 'lead' | 'agent' | 'system'; // default 'system'
  details?: Record<string, any>;     // optional context
}): Promise<void> {
  try {
    await db.insert(audit_log).values({
      agency_id: ctx.config.agency_id,
      action: opts.action,
      target_lead_id: opts.target_lead_id,
      admin_id: opts.admin_id ?? null,
      actor_type: opts.actor_type ?? 'system',
      details: opts.details ?? {},
      timestamp: new Date()
    });
  } catch (err) {
    // Never let logging failures break the operation
    console.error('[audit] recordAudit failed', opts, err);
  }
}
```

### Where to Call `recordAudit()`

**In `lib/agent/tools/main-assistant/leads.ts`:**

| Tool | Call | Example Detail |
|------|------|-----------------|
| `query_leads` | No | (read-only list, too noisy) |
| `search_leads` | No | (read-only, noisy) |
| `get_lead_detail` | **Yes** | `{ action: 'lead_detail_viewed', admin_id, details: { lead_id } }` |
| `update_lead_info` | **Yes** | `{ action: 'lead_updated', admin_id, details: { fields: [...], old: {...}, new: {...} } }` |
| `update_lead_persona` | **Yes** | `{ action: 'lead_persona_updated', admin_id }` |
| `delete_lead` | **Yes** | `{ action: 'lead_deleted', admin_id, details: { deleted_id: lead_id, cascade: ['conversations', 'messages'] } }` |
| `record_qualification` | **Yes** | `{ action: 'lead_qualified', admin_id, details: { qual_values, potential_status } }` |
| `remember_visitor_fact` | **Yes** | `{ action: 'lead_memory_added', admin_id, details: { fact_count: n } }` |
| `get_lead_threads` | No | (read-only) |
| `get_lead_viewings` | No | (read-only) |

**In `lib/agent/tools/main-assistant/messaging.ts`:**

| Tool | Call | Detail |
|------|------|--------|
| `send_reply` | **Yes** | `{ action: 'message_sent', admin_id, target_lead_id, details: { channel, length } }` |
| `draft_reply` | No | (not sent; draft deletion is implicit) |
| `promote_draft` | **Yes** | `{ action: 'draft_promoted', admin_id, target_lead_id }` |
| `take_over` | **Yes** | `{ action: 'conversation_takeover', admin_id, target_lead_id }` |
| `release_conversation` | **Yes** | `{ action: 'conversation_released', admin_id, target_lead_id }` |
| `trigger_lead_turn` | No | (system/agent action, handled separately if needed) |

**In consent + erasure tools (new):** See Section 3.

### Why NOT Log Query_leads / Search_leads

- Too frequent; would bloat audit log 10x with no legal requirement
- GDPR audit trail applies to **writes + sensitive reads** (detail views), not bulk list ops
- Compliance: admins viewing lists is not "processing" under CNIL guidance; detailed lead access is

---

## 3. GDPR RIGHTS IMPLEMENTATION

### 3a. Right-to-Erasure (Article 17)

**Reuse `delete_lead` tool, but with audit changes:**

Current `delete_lead`:
```typescript
await closeLeadTopics(lead_id).catch(() => {});
await deleteConversationsByLeadId(lead_id);
await deleteLead(lead_id);
```

**Enhanced to cascade + log erasure:**

```typescript
async execute: async ({ lead_id, confirm }) => {
  if (!confirm) return { error: 'confirmation_required' };
  const lead = await getLeadById(lead_id);
  if (!lead || lead.agency_id !== ctx.config.agency_id) return { error: 'lead_not_found' };
  
  // Closure: telegram topics
  await closeLeadTopics(lead_id).catch(() => {});
  
  // Cascade: conversations + messages
  await deleteConversationsByLeadId(lead_id);
  
  // Cascade: viewing slots (contact_email anonymization alternative: set contact_email=null)
  // Current: hard-delete if cascade enabled
  await db.delete(viewing_slots).where(eq(viewing_slots.lead_id, lead_id));
  
  // Cascade: lead consents (erase permission trail, per GDPR Art. 17)
  await db.delete(lead_consents).where(eq(lead_consents.lead_id, lead_id));
  
  // Erase sensitive fields in lead
  await updateLead(lead_id, {
    email: null,
    name: null,
    long_term_memory: null,
    persona: null,
    telegram_user_id: null
  });
  
  // Finally: hard-delete the lead record itself
  await deleteLead(lead_id);
  
  // Audit: mark erasure request
  await recordAudit(ctx, {
    action: 'lead_erasure_executed',
    admin_id: adminId,
    target_lead_id: lead_id,
    actor_type: 'admin',
    details: { 
      reason: 'GDPR Article 17 (right to erasure)',
      cascaded: ['conversations', 'messages', 'viewing_slots', 'lead_consents'],
      timestamp_utc: new Date().toISOString()
    }
  });
  
  broadcastAgencyDataChanged(ctx.config.agency_id);
  return { ok: true, deleted: lead_id, cascaded_records: ['conversations', 'messages', 'consents'] };
}
```

**Note:** Existing `deleteLead` helper may only soft-delete or partially cascade. Verify in `lib/db/leads.ts` before implementation.

### 3b. Right-of-Access (Article 15) — Data Export

**New Tool:** `export_lead_data`

```typescript
export_lead_data: tool({
  description:
    'Export all personal data for a lead (GDPR Art. 15). Returns JSON with profile, messages, consents, viewings.',
  inputSchema: z.object({
    lead_id: z.string().describe('Lead UUID'),
    format: z.enum(['json', 'markdown']).default('json')
      .describe('Export format: JSON or human-readable markdown')
  }),
  execute: async ({ lead_id, format }) => {
    const lead = await getLeadById(lead_id);
    if (!lead) return { error: 'lead_not_found' };
    
    // Gather all lead data
    const convs = await listConversationsByLeadId(lead_id);
    const messages = await Promise.all(
      convs.map((c) => getVisibleMessages(c.id))
    );
    const consents = await db.select().from(lead_consents)
      .where(eq(lead_consents.lead_id, lead_id))
      .orderBy(desc(lead_consents.recorded_at));
    const viewings = await listViewingsByLead(lead_id);
    
    const exportData = {
      lead: {
        id: lead.id,
        email: lead.email,
        name: lead.name,
        created_at: lead.created_at,
        channel: lead.channel,
        status: lead.status,
        qualification: lead.qual_values,
        persona: lead.persona,
        long_term_memory: lead.long_term_memory
      },
      conversations: convs.map((c) => ({
        id: c.id,
        type: c.type,
        channel: c.primary_channel,
        created_at: c.created_at
      })),
      messages: messages.flat().map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      })),
      consents: consents.map((c) => ({
        type: c.consent_type,
        granted: c.granted,
        recorded_at: c.recorded_at,
        source: c.source
      })),
      viewings: viewings.map((v) => ({
        listing_id: v.listing_id,
        slot: v.confirmed_slot,
        status: v.status
      })),
      export_timestamp: new Date().toISOString()
    };
    
    // Audit
    await recordAudit(ctx, {
      action: 'lead_data_exported',
      admin_id: adminId,
      target_lead_id: lead_id,
      actor_type: 'admin',
      details: { format, record_count: messages.flat().length }
    });
    
    if (format === 'markdown') {
      return {
        ok: true,
        export: formatAsMarkdown(exportData) // implement helper
      };
    }
    return { ok: true, export: exportData };
  }
})
```

### 3c. Consent Management Tools (New)

**Tool 1: `view_consent_status`**

```typescript
view_consent_status: tool({
  description: 'Retrieve current consent state for a lead (data_processing, marketing, phone).',
  inputSchema: z.object({ lead_id: z.string() }),
  execute: async ({ lead_id }) => {
    const consents = await db.select().from(lead_consents)
      .where(eq(lead_consents.lead_id, lead_id));
    
    const latest = Object.fromEntries(
      Array.from(new Set(consents.map((c) => c.consent_type))).map((type) => [
        type,
        consents
          .filter((c) => c.consent_type === type)
          .sort((a, b) => b.recorded_at.getTime() - a.recorded_at.getTime())[0]
      ])
    );
    
    return {
      ok: true,
      consents: latest,
      last_updated: new Date()
    };
  }
})
```

**Tool 2: `set_consent`** (admin)

```typescript
set_consent: tool({
  description: 'Record a consent decision for a lead (admin records offline consent, or withdrawal).',
  inputSchema: z.object({
    lead_id: z.string(),
    consent_type: z.enum(['data_processing', 'marketing', 'phone_contact']),
    granted: z.boolean().describe('true = consent given, false = withdrawn'),
    notes: z.string().max(500).optional()
  }),
  execute: async ({ lead_id, consent_type, granted, notes }) => {
    const lead = await getLeadById(lead_id);
    if (!lead) return { error: 'lead_not_found' };
    
    await db.insert(lead_consents).values({
      agency_id: ctx.config.agency_id,
      lead_id,
      consent_type,
      granted,
      source: 'admin_manual',
      recorded_by: adminId,
      notes,
      recorded_at: new Date()
    });
    
    await recordAudit(ctx, {
      action: 'consent_updated',
      admin_id: adminId,
      target_lead_id: lead_id,
      details: { consent_type, granted, source: 'admin_manual' }
    });
    
    return { ok: true, consent_type, granted };
  }
})
```

---

## 4. MAIN_ASSISTANT TOOL SUMMARY

| Tool | Purpose | Audit Logged |
|------|---------|--------------|
| `view_consent_status` | Query current consent state | No (read-only) |
| `set_consent` | Admin records/withdraws consent | **Yes** |
| `export_lead_data` | GDPR Art. 15 data bundle | **Yes** |
| `delete_lead` (enhanced) | GDPR Art. 17 erasure + cascades | **Yes** |
| Existing lead/messaging tools | Enhanced with audit calls | Selective (see table §2) |

---

## 5. OUT OF SCOPE (For Future Phases)

### 5a. Retention Policies
- No auto-purge scheduled jobs
- CNIL recommends retention = "as long as relationship is active + 3y after" for lead CRMs
- **Action:** Implement in phase-02; add `retention_expires_at` column and a cron job
- **Placeholder comment:** Mark in schema

### 5b. Data Minimization
- Current `qual_values` (jsonb) allows arbitrary keys
- No validation that only necessary qualification criteria are stored
- **Action:** `agency_config.qualification_criteria` already defines allowed keys; validate in `record_qualification` tool (not logging-scope)

### 5c. Third-Party Integrations (Google Calendar, SendGrid, Telegram)
- Scope: this design logs OUR actions (booking, message) but not Google/SendGrid replies
- CNIL: you must document those integrations in your privacy policy; out of logging scope
- **Note:** Audit log includes `action: 'viewing_booked'` (our action), not Google's confirmation

### 5d. Right-to-Rectification (Article 16)
- Partially covered: `update_lead_info` allows email/name correction
- Full GDPR rectification UX (self-service lead portal) is out of scope
- **Audit:** Already logged via `lead_updated` action

### 5e. Data Transfer (Article 20)
- `export_lead_data` covers the technical requirement
- Legal format/process (responding to formal CNIL requests) out of scope

---

## 6. DATABASE MIGRATION PATH

Assume `drizzle-kit push` (no versioned migrations). Add to `schema.ts`:

```typescript
// Add to schema.ts
export const lead_consents = pgTable(...); // See §1
export const audit_log = pgTable(...);     // See §2

// Run: npx drizzle-kit push
// Result: two new tables created atomically
```

Then:

1. **Create consent seeding** (optional, dev): `scripts/seed-initial-consents.ts`
   - For existing leads, insert a row: `{ consent_type: 'data_processing', granted: true, source: 'migration', recorded_at: lead.created_at }`
   - Justification: they were not asked, but processing was already happening; document baseline

2. **Create audit helper** (`lib/db/audit-helpers.ts`) before adding any audit calls

3. **Incrementally wire audit calls into tools** (one tool group at a time, per team workflow)

---

## 7. FRENCH MARKET / CNIL NOTES

- **CNIL Basis:** These design patterns align with CNIL's *Délibération n°2020-092* (recommandations sur l'e-mailing) and *Guide Privacy by Design*.
- **Legal Basis:** Consent (`lead_consents.granted=true`) establishes Art. 6(1)(a) basis for processing. Document in privacy policy which consents are required vs. optional.
- **Cookie Consent:** Separate concern (frontend, analytics). This design focuses on CRM lead data; assume cookie banner already in place.
- **Data Processing Addendum:** If using SendGrid / Google Calendar, you need DPA with those vendors (out of logging scope).
- **Admin Accountability:** `audit_log.admin_id + recorded_by` provides the "who + when" trail CNIL asks for during audits.

---

## 8. ARCHITECTURAL TRADE-OFFS

| Aspect | Chosen | Alternative | Why Not |
|--------|--------|-------------|--------|
| **Consent** | Separate table | Columns on `leads` | Bloats lead row; no multi-type history |
| **Audit** | String action + jsonb details | Enum actions | More future-proof; no schema rewrites per action |
| **Consent History** | Append-only rows | Update in-place | Immutable trail required for audit; withdrawal must not erase grant fact |
| **Audit Calls** | Single `recordAudit()` helper | Scattered logging | Avoids boilerplate; easier to test; consistent detail shape |
| **Delete** | Hard-delete with cascades | Soft-delete (mark archived) | GDPR erasure = deletion; soft-delete conflicts with "right to erasure" semantics |

---

## 9. OPEN QUESTIONS

1. **Viewing Slots Cascade:** Current `viewing_slots` schema stores `contact_email` (redundant copy from lead). Should erasure hard-delete the slot, or mask `contact_email=null` + keep metadata for calendar cleanup?
   
2. **Long-term Memory / Persona Erasure:** These fields contain AI-generated summaries. Masking to `null` is pragmatic, but should we archive them before deletion (e.g., in `audit_log.details`) for dispute resolution?

3. **Telegram Message Deletion:** When a lead is erased, `conversations + messages` are hard-deleted. But messages already sent to the Telegram group are NOT deleted from Telegram itself (no API for this). Document as limitation in admin UI?

4. **Admin Session Audit:** Should admin login/logout be logged? Currently out of scope; suggest as phase-02 task if compliance requires it.

5. **Consent UI/Form:** `set_consent` tool assumes admin manually records. Is there a lead self-service form (web checkbox) that auto-inserts `granted=true, source='web_form'`? If so, hook it before implementation.

6. **Message Forwarding:** If an admin "forwards" a lead's message out of the system (screenshot → email), is that a new "processing"? Logging captures the forward, but privacy policy must document it separately.

---

## IMPLEMENTATION CHECKLIST (Not Doing Yet)

- [ ] Add `lead_consents` table to `schema.ts`
- [ ] Add `audit_log` table to `schema.ts`
- [ ] Create `lib/db/audit-helpers.ts` with `recordAudit()` function
- [ ] Create `lib/db/consent-helpers.ts` with query helpers (optional, if reused)
- [ ] Add consent tools to `lib/agent/tools/main-assistant/leads.ts`
- [ ] Add audit calls to `lib/agent/tools/main-assistant/leads.ts` execute bodies
- [ ] Add audit calls to `lib/agent/tools/main-assistant/messaging.ts` execute bodies
- [ ] Enhance `delete_lead` with cascade + audit
- [ ] Add `export_lead_data` tool
- [ ] Create Drizzle migration (`drizzle-kit push`)
- [ ] Write integration tests for `recordAudit()` helper
- [ ] Document audit log retention schedule (phase-02)
- [ ] Add admin UI view for audit trail (phase-03)

---

## SUMMARY

**Minimal defensible design:**
- **Consent:** Append-only `lead_consents` table (3 types, withdrawal = new row with `granted=false`)
- **Audit:** Single `audit_log` table + `recordAudit()` DRY helper (called from tool execute bodies)
- **GDPR Rights:** Enhanced `delete_lead` (cascades + logs erasure), new `export_lead_data` tool, consent management tools
- **Scope:** Covers Art. 6/17/15/21; retention/minimization/transfers out of MVP scope
- **Compliance:** Align with CNIL guidance; no legal basis logic in code (policy-level decision)

**Estimated LOC:** ~250 (schema) + ~150 (helpers) + ~300 (tool bodies) = ~700 new lines, all <200 per file. No changes to existing tool logic—audit calls are additive.

