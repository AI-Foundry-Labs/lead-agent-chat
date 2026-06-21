# Phase 03 — Anonymous visitor pool for main_assistant (F1)

## Context Links
- Overview: [plan.md](plan.md) · Foundations: [phase-00](phase-00-foundations-shared.md)
- Reuse: `lib/telegram/promote-anonymous-visitor.ts` (`promoteAnonymousVisitor`)
- Reuse: `lib/agent/tools/operator-thread-tools.ts` (pool-mode `list_threads`/`get_thread`)
- DB: `lib/db/conversations.ts` → `listAnonymousVisitorThreads`, `attachLeadIfAnonymous`
- `lib/leads/is-identified-lead.ts`; `lib/db/leads.ts` (`createLead`, `updateLead`, `deleteLead`)

## Overview
- **Priority:** P2 · **Status:** pending · **Risk:** Medium
- main_assistant currently only sees identified leads (`query_leads`/`search_leads` over `leads`).
  Give it: (a) list anon pool, (b) read an anon thread, (c) identify/claim a visitor, (d) optional
  merge of an anon thread into an existing identified lead.

## Key Insights
- The anon pool already has a canonical query: `listAnonymousVisitorThreads(agencyId)` (returns
  conversations with null lead_id OR lead with null email+name). Reuse it — do NOT write a new query.
- Operator tools already expose pool-mode read via `buildOperatorThreadTools(ctx, null)`. main_assistant
  is a different surface; safest is to add main_assistant tools that call the SAME db helpers (DRY at the
  data layer), not to re-scope operator tools.
- Identify/claim has two cases:
  1. Conversation still anonymous (lead_id null) → create lead + `attachLeadIfAnonymous` (race-safe).
     This is essentially what `promoteAnonymousVisitor` does, minus Telegram provisioning. **Reuse it**
     then `updateLead` with name/email — or extend it to accept name/email (preferred, see OQ-03-1).
  2. Conversation has an unidentified lead (lead exists, email+name null) → just `updateLead` name/email.
- Merge (d) is the genuinely hard part — no existing primitive. See architecture + OQ.

## Requirements
**Functional:**
- `list_visitor_pool(limit?)` — anon/unidentified threads for the agency.
- `read_visitor_thread(conversation_id)` — messages of an in-pool thread (assert it's anon/unidentified).
- `identify_visitor(conversation_id, name?, email?)` — promote/attach + set name/email → identified lead.
- `merge_visitor_into_lead(source_conversation_id, target_lead_id)` — OPTIONAL; move anon thread's
  messages under an existing identified lead.
**Non-functional:** agency-scoped; race-safe attach; never throw into the turn.

## Architecture
- Data flow (identify): assert conversation in pool → if lead_id null, reuse promote path (create lead,
  `attachLeadIfAnonymous`); if attach lost the race, re-read and use the winner's lead → `updateLead`
  {name,email} → return identified lead. Reuses Telegram topic provisioning already inside
  `promoteAnonymousVisitor` (free side benefit).
- **Merge semantics (decision needed — OQ-03-2).** Options:
  - **M1 (re-point):** `UPDATE conversations SET lead_id=target WHERE id=source`. Messages follow
    (they hang off conversation_id). Source anon lead (if any) becomes orphan → delete it. Simplest, KISS.
    Risk: target lead now has 2+ conversations (already supported — `listConversationsByLeadId`).
  - **M2 (copy):** copy messages into target's primary conversation. Loses thread boundaries; more code.
    Rejected (YAGNI).
  - **Recommend M1.** Telegram topics of the source anon lead must be closed/remapped (`closeLeadTopics`)
    — flag as the tricky bit.
- Anonymous leads with anon_seq + their Telegram topics: merging must not leave dangling topic rows.

## Related Code Files
**Create:**
- `lib/agent/tools/main-assistant/visitor-pool.ts` — `buildVisitorPoolTools(ctx)` (~150 LOC).
- (maybe) `lib/leads/merge-anonymous-into-lead.ts` — merge primitive (M1) if (d) approved (~80 LOC).

**Modify:**
- `lib/telegram/promote-anonymous-visitor.ts` — optionally accept `{name,email}` to set on creation
  (preferred over create-then-update; see OQ-03-1). Keep race-safety.
- `lib/agent/tools/main-assistant/index.ts` — register `buildVisitorPoolTools`.
- `lib/agent/prompts/main-assistant-prompt.ts` — note: the agent can now triage anonymous visitors.

## Implementation Steps
1. Build `list_visitor_pool` + `read_visitor_thread` (call `listAnonymousVisitorThreads`, reuse
   operator-tool's `assertThread` logic — extract shared assert into `is-identified-lead`-adjacent util? OQ-03-3).
2. Build `identify_visitor`: handle null-lead vs unidentified-lead cases; race-safe.
3. (If approved) build `merge_visitor_into_lead` via M1 primitive + close source topics.
4. Register + prompt note.
5. typecheck/build; manual: anon visitor → identify → appears in `query_leads`.

## Todo List
- [ ] list_visitor_pool + read_visitor_thread (reuse existing helpers)
- [ ] identify_visitor (both cases, race-safe)
- [ ] (optional) merge_visitor_into_lead (M1) + close source topics
- [ ] register + prompt note
- [ ] typecheck/build + manual flow

## Success Criteria
- Agent lists pool, reads an anon thread, identifies it (name/email set) → visitor now appears in
  `query_leads` as identified. Merge (if built) re-points thread to target lead, no orphan/dangling topic.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Double-attach race on identify | Med×Med | Reuse `attachLeadIfAnonymous` conditional UPDATE; handle null return |
| Merge leaves dangling Telegram topic rows | Med×Med | Call `closeLeadTopics(sourceLead)`; delete orphan anon lead |
| Cross-agency visitor access | Low×High | Assert conversation.agency_id == ctx agency in every tool |
| Merge data loss | Low×High | Use re-point (M1), never copy/delete messages |

## Security / GDPR Considerations
- Identify writes PII (name/email) onto a lead — should emit Phase 04 audit `lead_updated` /
  `lead_identified`. Merge is sensitive → audit `lead_merged`. (Wired in Phase 04.)

## Next Steps
- Tools created here get audit hooks in Phase 04.

## OPEN QUESTIONS
- **OQ-03-1:** Extend `promoteAnonymousVisitor` to accept name/email, or create-then-`updateLead`?
  Proposed: extend (one round-trip, atomic-ish).
- **OQ-03-2:** Is merge (d) in MVP scope? If yes, confirm M1 re-point semantics + what happens to the
  source anon lead's `anon_seq` and Telegram topics.
- **OQ-03-3:** Share the `assertThread` pool/identified logic between operator-thread-tools and the new
  visitor-pool tools (extract a util) vs duplicate? Proposed: extract small shared util (DRY).
- **OQ-03-4:** Should identifying a visitor optionally send them a confirmation message, or pure data op?
  Proposed: pure data op (agent can chain `send_reply`).
