# Agent Core Review — 260623

Scope: `lib/agent/run.ts`, `lib/agent/tools/*`, prompts, `staff-report.ts`, `push-agent-notification.ts`, `lib/llm.ts`, `lib/dispatch.ts`, `lib/notify.ts`, `lib/agent/thread-memory.ts`. Whole-codebase (not diff).

Dominant theme: **the agent loop is solid, but tools systematically trust LLM-supplied IDs (`lead_id`, `conversation_id`, `viewing_id`, `rule_id`) without verifying agency ownership.** Multi-tenant boundary is enforced inconsistently — some tools check `lead.agency_id === agencyId`, many do not. A prompt-injected or confused model can read/mutate another agency's data.

---

## CRITICAL

### C1. `notifyAdmins` / `sendToLinkedAdmins` fan out cross-tenant (PII leak)
`lib/telegram.ts:197` selects **every** admin with a linked Telegram, no agency filter:
```ts
.select({ telegram_user_id: admins.telegram_user_id }).from(admins).where(isNotNull(admins.telegram_user_id))
```
`lib/notify.ts:9` (`notifyAdmins`) passes no agency. Reached from `pushAgentNotification` (run.ts handoff/manual, lead-tools booking/cancel/reschedule, operator handoff) and the `notify_admin` tool in lead/operator/subagents. Result: agency A's handoff alerts, booking contacts (name + email), and lead message excerpts (`message.slice(0,300)`) are DM'd to admins of agencies B, C, … Same bug in `notifyAdminsInChat` (`lib/notify.ts:19`, selects all admins) — writes one agency's notice into every agency's main_assistant history. **Cross-tenant PII disclosure.** notifyAdmins must take an `agencyId` and filter `admins.agency_id`.

### C2. main_assistant message tools accept any `lead_id`/`conversation_id` (no agency scope)
`lib/agent/tools/main-assistant/messaging.ts`:
- `get_conversation_messages` (l.111) → `getVisibleMessages(conversation_id)` with **zero** scoping (`lib/db/messages.ts:27` is unscoped). Reads any conversation in the DB.
- `send_reply` (l.123), `draft_reply` (l.151), `promote_draft` (l.163), `get_draft` (l.182), `take_over` (l.193), `release_conversation` (l.206), `trigger_lead_turn` (l.218) → resolve via `getConversationByLeadId(lead_id)` (`lib/db/conversations.ts:58`, **unscoped**) then mutate/send. An admin's assistant can message, take over, or trigger turns on **another agency's leads**.
- `subagents.ts trigger_operator_briefing` (l.31) `getLeadById` no agency check → runs the operator agent (full profile + history) on any lead → exfiltrates cross-agency PII into the reply.

Fix: every tool must `getLeadById` / `getConversation` then reject when `row.agency_id !== ctx.config.agency_id` (the pattern `leads.ts` already uses in `get_lead_detail`/`update_lead_info`).

### C3. `search_leads` queries all agencies
`main-assistant/leads.ts:50` runs `ilike(email)/ilike(name)` across the whole `leads` table with no `agency_id` predicate. Any admin searching by name/email gets matching leads from **every** tenant (id, email, name, status, score_reason). Add `eq(leads.agency_id, agencyId)` to the WHERE.

### C4. operator lead-action tools mutate any lead/viewing
`operator-lead-actions.ts`: `update_lead_status` (l.21), `record_qualification` (l.70), `remember_visitor_fact` (l.102), `get_lead_viewings` (l.117), `request_handoff` (l.153) take an explicit `lead_id` and `getLeadById(id)` with **no agency check** → mutate/read foreign leads. `cancel_viewing` (l.136) / `reschedule_viewing` (l.146) pass `viewing_id` straight to the action helper with no ownership guard at all. Same class as C2.

---

## IMPORTANT

### I1. `get_listing` lead-tool leaks cross-agency listings
`lead-tools.ts:44` `get_listing({listing_id})` → `getListing(listing_id)` (`lib/db/listings.ts:47`, unscoped). A lead (untrusted, prompt-injectable) can pass any UUID and read another agency's full listing row. Scope to `ctx.config.agency_id`, or only allow the conversation's own `listingId`.

### I2. `toggle_handoff_rule` / `delete_handoff_rule` no agency check
`main-assistant/config.ts:125,138` accept arbitrary `rule_id` → `toggleHandoffRule`/`deleteHandoffRule` with no ownership verification. Cross-agency rule tampering (disable a competitor's escalation rules, or delete them). Verify the rule's `agency_id` first.

### I3. `ensureLead` is not race-safe (orphan leads / lost writes)
`lib/agent/tools/context.ts:19` creates a lead then does an **unconditional** `updateConversation(id, {lead_id})`. Two concurrent tool calls in one turn, or a tool call racing `promoteAnonymousVisitor`, each create a lead and last-writer-wins → orphaned lead rows + the mutated lead (qual_values/booking) may be attached to a conversation that another writer overwrote. `promoteAnonymousVisitor` got this right via `attachLeadIfAnonymous` (conditional UPDATE) + orphan cleanup; `ensureLead` should use the same conditional-attach + re-read pattern.

### I4. No per-conversation concurrency guard on lead turns
`runAgentTurn` is fully stateless/optimistic — nothing prevents two POSTs to `/api/chat` for the same conversation running concurrently (double-send from UI, retries). Effects: interleaved transcript writes, double bookings if both pass the `findBookedSlot` idempotency check before either inserts (TOCTOU — `book_viewing` lead-tools.ts:177-193 reads-then-writes with no unique constraint/lock), duplicated promotion. Consider an advisory lock or unique constraint on `(conversation_id, confirmed_slot)`.

### I5. `bulk_follow_up` unbounded N+1 + no agency check on inner conv
`subagents.ts:47` loops every hot/warm lead, doing `getConversationByLeadId` + `addMessage` + `dispatchReply` (→ email/Telegram send) sequentially inside one tool call. For a large agency this blows the per-turn latency and the `stepCountIs(MAX_STEPS=10)` won't bound it (it's one step). No batching, no cap on number of leads contacted, no dry-run. A single LLM tool call can mass-email the entire lead base. At minimum cap the recipient count and surface it for confirmation.

### I6. Empty-reply fallback dispatched to lead channel as a real message
`run.ts:265-287`: on empty model output a canned apology is **persisted and dispatched** to the lead (email/Telegram) for every lead turn (`shouldDispatchContent = … || type==='lead'`). An LLM hiccup (rate limit, finishReason=tool-calls with no text) sends the visitor an unsolicited "an error occurred" email/Telegram. Acceptable for web (inline) but spamming external channels on transient model errors is risky — gate external dispatch of the fallback behind a real-error signal, not "lead always".

---

## MINOR

- **M1.** `run.ts:184` casts `runAgentTurn as Parameters<…>[3]` to break a self-reference type — fine, but the recursion (`trigger_lead_turn`/`trigger_operator_briefing` → `runAgentTurn` → tools → `runAgentTurn`) has **no depth guard**. A main_assistant prompt-injected to keep triggering turns can recurse; each level is independently step-capped but nesting is unbounded. Add a depth counter to `Actor`.
- **M2.** `MAX_STEPS=10` in `run.ts:52` contradicts README "stepCountIs(6)". Doc drift; confirm intended cap.
- **M3.** `detectMessageLang` (run.ts:109) is `await`ed on the hot path despite the comment "runs in background" — adds an LLM round-trip of latency to every lead turn before generation. Comment is wrong or the call should be deferred.
- **M4.** PII in logs: `agent.handoff` logs `rule.description`; handoff/manual notes embed `message.slice(0,300)` and are also `console.log`'d via `notifyAdmins` (`notify.ts:10`). Lead message content + booking emails land in stdout logs. Scrub or hash for prod.
- **M5.** `get_conversation_messages` has no agency check even ignoring C2 — also returns `role:'admin'`/internal notes to the model verbatim; fine within tenant but compounds C2.
- **M6.** `trigger_lead_turn` language detection (messaging.ts:231) is a crude regex; non-Latin scripts default to 'fr'. Cosmetic.
- **M7.** `mirrorLeadTurnToTopic` swallows errors (good) but `dispatch.ts` `dispatchReply` does **not** wrap sends — a Telegram/email failure throws into `runAgentTurn` after the assistant message is already persisted, so the turn 500s even though state is saved. Consider try/catch around external dispatch.

---

## What's good
- Tool inputs are consistently Zod-validated; invalid args return tool errors, not throws (per README guardrail — holds).
- `book_viewing` idempotency, `need_contact`, ISO snap-back (`resolveSlotIso`) are thoughtful.
- `staff-report.ts` never throws — deterministic fallback on LLM failure. Solid.
- `promoteAnonymousVisitor` conditional-attach race handling is correct.
- `lead-tools.ts` viewing tools (`cancel_viewing`/`reschedule_viewing`) DO guard `viewing.conversation_id === ctx.conversation.id` — the right pattern, just not replicated to operator/main_assistant tools.
- `search_messages` (messaging.ts) was fixed to be agency-scoped (noted in-code) — the one query that gets it right.
- `lib/llm.ts` fails loud on missing provider prefix/key.

---

## Unresolved questions
1. Is multi-tenant the real deployment model, or single-agency-per-instance? If the latter, C1/C2/C3/C4/I1/I2 drop from Critical to hardening. The schema, middleware `x-agency-id`, and `agency_id` FKs everywhere imply **true multi-tenant** → these are live cross-tenant holes.
2. README says `stepCountIs(6)`, code says 10 (M2) — which is intended?
3. Is concurrent same-conversation submission actually reachable from the UI, or serialized client-side? Affects I4 severity.

---

Status: DONE_WITH_CONCERNS

Summary: Agent loop, Zod validation, and error-fallback design are sound, but tenant isolation is enforced inconsistently across tools — many main_assistant/operator/lead tools trust LLM-supplied IDs and `notifyAdmins` fans out to all agencies, opening cross-tenant read/mutate and PII-leak paths.

Top 3: (1) `notifyAdmins`/`sendToLinkedAdmins` notify every agency's admins — cross-tenant PII leak. (2) main_assistant message/briefing tools (`get_conversation_messages`, `send_reply`, `take_over`, `trigger_*`) accept any unscoped `lead_id`/`conversation_id`. (3) `search_leads` and operator lead-action tools query/mutate leads with no `agency_id` check.
