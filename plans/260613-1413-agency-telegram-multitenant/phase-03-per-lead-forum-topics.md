# Phase 03 — Per-Lead Forum Topics (2 topics/lead)

## Overview
- **Priority:** High
- **Status:** completed
- **Description:** When a lead first appears (form submit or first web chat), lazily create **two** forum topics in the agency group: 💬 Conversation (mirror lead↔agent) and 🤖 Assistant (per-lead copilot). Persist the mapping.

## Key Insights
- Topic 1 maps to the existing `lead` conversation; Topic 2 maps to the existing `operator` conversation scoped to that lead (`conversations.ts:198`, `operator-lead-actions.ts`). **No new conversation type.**
- Topic creation must be **lazy + idempotent** — never duplicate topics on retries/concurrent turns (Telegram retries webhooks). Use a DB unique constraint + create-once guard.
- If the agency hasn't linked a group yet, skip topic creation gracefully (web-only still works).

## Requirements
**Functional**
- `getOrCreateLeadTopics(agencyId, leadId)` → ensures both topics exist, returns ids + operator conversation id.
- Topic titles include lead name + listing (e.g. `💬 Marie D. — Marais 2BR`, `🤖 Marie D. — Assistant`).
- Mapping row links: lead → group_chat_id, conversation_topic_id, assistant_topic_id, lead conversation_id, operator conversation_id.

**Non-functional**
- Idempotent under concurrency (unique constraint on `(group_chat_id, lead_id)`).
- Best-effort: a Telegram failure must not block the web turn (wrap, log, continue).

## Architecture
```
lead_telegram_topics
  id, agency_id, lead_id (unique per group), group_chat_id,
  conversation_topic_id int, assistant_topic_id int,
  lead_conversation_id, operator_conversation_id,
  status ('open'|'closed'), created_at

getOrCreateLeadTopics(agencyId, leadId):
  · resolve agency.telegram_group_chat_id (skip if null)
  · SELECT existing mapping → return if present
  · createForumTopic(group, "💬 …")  → conversation_topic_id
  · createForumTopic(group, "🤖 … — Assistant") → assistant_topic_id
  · getOrCreateOperatorConversation(leadId)  [existing helper]
  · INSERT mapping (ON CONFLICT DO NOTHING → re-select)
```

## Related Code Files
**Modify**
- `lib/db/schema.ts` — `lead_telegram_topics` table + unique index.
- `lib/db/index.ts` — exports.
- `lib/telegram.ts` — `createForumTopic`, `editForumTopic`, `closeForumTopic` wrappers (grammY).
- Lead-creation path (web form submit + first chat turn in `lib/agent/run.ts` / chat route) — invoke `getOrCreateLeadTopics` (fire-and-forget, awaited-but-guarded).

**Create**
- `lib/telegram/lead-topics.ts` — `getOrCreateLeadTopics`, `closeLeadTopics`, title builders.
- `lib/db/lead-telegram-topics.ts` — mapping CRUD + lookups by topic id.

## Implementation Steps
1. Add `lead_telegram_topics` table with unique `(group_chat_id, lead_id)` and an index on `(group_chat_id, conversation_topic_id)` + `(group_chat_id, assistant_topic_id)` for reverse routing (Phase 04).
2. Add grammY topic wrappers in `lib/telegram.ts`.
3. Implement `getOrCreateLeadTopics` with idempotent insert + reuse of existing operator-conversation helper.
4. Hook into lead creation: on web form submit and on first lead chat turn, trigger it **off the response path** (red-team M1 — don't block the first web reply on 2 `createForumTopic` round-trips); guarded; skip if no group. Open risk: supergroup max-topics ceiling unverified (red-team M3) — verify before assuming unbounded topic-per-lead.
5. Title builder: lead display name fallback (email/`Visiteur`) + listing title.
6. `npm run typecheck`.

## Todo List
- [x] `lead_telegram_topics` table + unique/reverse indexes
- [x] grammY topic wrappers
- [x] `getOrCreateLeadTopics` (idempotent)
- [x] Wire into lead-creation / first-turn path (guarded)
- [x] Title builders
- [x] typecheck clean

## Success Criteria
- New lead → exactly two topics appear in the agency group; repeated turns never duplicate.
- Mapping row resolvable by either topic id (for Phase 04 routing).
- Web chat works unchanged when agency has no linked group.

## Risk Assessment
- **High:** duplicate topics under webhook retry/concurrency. Mitigation: unique constraint + ON CONFLICT + re-select; create topics then insert (accept rare orphan topic on crash, reconcile by name lookup).
- **Medium:** topic sprawl as leads age. Mitigation: `closeLeadTopics` exists; auto-archive deferred (note in plan Out of Scope).

## Security Considerations
- Topic mapping carries `agency_id`; all lookups scoped so one agency can't address another's topics.

## Next Steps
- Phase 04 mirrors messages into Topic 1 and routes inbound group messages by topic id.
