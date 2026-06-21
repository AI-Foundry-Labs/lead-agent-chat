# Phase 02 — Telegram message-history search (F4c)

## Context Links
- Overview: [plan.md](plan.md) · Foundations: [phase-00](phase-00-foundations-shared.md)
- Existing search: `lib/agent/tools/main-assistant/messaging.ts` → `search_messages`
- Channel model: `conversations.primary_channel` ('web'|'email'|'telegram'); `messages` has NO channel col.
- Group topics: `lib/db/lead-telegram-topics.ts`, `lead_telegram_topics` table.

## Overview
- **Priority:** P2 · **Status:** pending · **Risk:** Low
- Let main_assistant search messages exchanged over Telegram specifically. Channel lives on the
  conversation, so this is a filtered variant of the existing `search_messages`.

## Key Insights
- `messages` has no channel → filter via join `conversations.primary_channel = 'telegram'`.
- TWO distinct Telegram surfaces (decide scope, OQ-02-1):
  1. **Lead DM Telegram threads** — `conversations.primary_channel='telegram'` (visitor's own DM).
  2. **Agency group topics** — the 💬/🤖 forum topics mirrored via `lead_telegram_topics`. These map to
     `lead_conversation_id` / `operator_conversation_id` conversations; their own `primary_channel`
     may be 'web' (mirror) not 'telegram'. Searching "telegram group" = search those conversations.
- DRY: extend existing `search_messages` with optional `channel` filter rather than a new near-duplicate
  tool. Add a thin `search_telegram_messages` alias only if the model needs an explicit affordance.

## Requirements
**Functional:** search keyword across messages where conversation is Telegram-channel; return
excerpt + lead/conversation context + which surface (DM vs group). Agency-scoped.
**Non-functional:** reuse existing query shape; cap limit ≤30; case-insensitive `ilike`.

## Architecture
- Extend `search_messages` input with `channel?: 'web'|'email'|'telegram'|'all'` (default 'all'
  = current behavior, backwards compatible).
- When `channel='telegram'`: add `eq(conversations.primary_channel,'telegram')` AND
  `eq(conversations.agency_id, ctx.config.agency_id)` (existing tool is NOT agency-scoped — fix while here).
- For group-topic scope (if in scope): also include conversations whose id ∈ (`lead_conversation_id`,
  `operator_conversation_id`) from `lead_telegram_topics` for this agency.

## Related Code Files
**Modify:**
- `lib/agent/tools/main-assistant/messaging.ts` — add `channel` filter + agency scope to `search_messages`.
- `lib/agent/prompts/main-assistant-prompt.ts` — note channel filter exists.

**Create (only if explicit alias wanted):**
- none by default (extend existing — DRY). Optional `search_telegram_messages` thin wrapper.

## Implementation Steps
1. Decide scope (OQ-02-1): DM only / group only / both.
2. Add `channel` to `search_messages` Zod input (default keeps current behavior).
3. Add `agency_id` scope to the query (bugfix: current tool is cross-agency).
4. If group scope included, add the `lead_telegram_topics` conversation-id branch.
5. Return `surface: 'dm'|'group'` per row.
6. typecheck/build.

## Todo List
- [ ] Resolve OQ-02-1 scope
- [ ] Add `channel` filter + agency scope to search_messages
- [ ] (if both) group-topic conversation branch
- [ ] surface tag in results
- [ ] prompt note + typecheck/build

## Success Criteria
- `search_messages({query, channel:'telegram'})` returns only Telegram-surface messages for the
  current agency; default call unchanged (backwards compatible).

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Existing `search_messages` leaks cross-agency data | Med×High | Add agency scope (bugfix this phase) |
| Behavior change breaks existing default callers | Low×Med | `channel` optional, default='all' = old behavior |
| Group vs DM ambiguity confuses agent | Med×Low | `surface` field in results + prompt note |

## Security / GDPR Considerations
- Adds agency scoping to a previously unscoped tool — a security improvement. Reads are sensitive;
  consider auditing via Phase 04 `recordAudit` if search returns lead PII (flag, OQ-02-2).

## Next Steps
- Independent. Audit hook optional, depends on Phase 04.

## OPEN QUESTIONS
- **OQ-02-1:** Scope — lead-DM Telegram threads, agency group topics, or both? Proposed: both, tagged.
- **OQ-02-2:** Should Telegram search be audit-logged (Phase 04)? Proposed: no (read of excerpts, noisy).
- **OQ-02-3:** Fixing the cross-agency leak in `search_messages` is in-scope here — confirm acceptable
  (slight behavior change for any multi-agency deployment).
