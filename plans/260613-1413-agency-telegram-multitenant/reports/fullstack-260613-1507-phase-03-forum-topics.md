# Phase 03 Implementation Report — Per-Lead Forum Topics

## Phase
- Phase: phase-03-per-lead-forum-topics
- Plan: plans/260613-1413-agency-telegram-multitenant/
- Status: completed

## Files Modified

| File | Change |
|------|--------|
| `lib/db/schema.ts` | Added `lead_telegram_topics` table: unique (group_chat_id, lead_id), reverse indexes on (group_chat_id, conversation_topic_id) and (group_chat_id, assistant_topic_id) |
| `lib/db/client.ts` | Exported `lead_telegram_topics` from schema destructure |
| `lib/db/index.ts` | Added `lead_telegram_topics` table re-export + `* from './lead-telegram-topics'` |
| `lib/telegram.ts` | Added `createForumTopic`, `editForumTopic`, `closeForumTopic` wrappers matching existing grammY style |
| `lib/agent/tools/context.ts` | Fire-and-forget `getOrCreateLeadTopics` call after lead creation |
| `lib/telegram/ensure-lead-for-conversation.ts` | Same fire-and-forget after lead creation |

## Files Created

| File | Purpose |
|------|---------|
| `lib/db/lead-telegram-topics.ts` | CRUD: `getLeadTopicsByLead`, `getLeadTopicsByConversationTopic`, `getLeadTopicsByAssistantTopic`, `insertLeadTopics` (ON CONFLICT DO NOTHING + re-select), `closeLeadTopics` |
| `lib/telegram/lead-topics.ts` | `getOrCreateLeadTopics`, `closeLeadTopics`, title builders (`buildLeadDisplayName`, `buildConversationTopicTitle`, `buildAssistantTopicTitle`) |

## Tasks Completed

- [x] `lead_telegram_topics` table + unique/reverse indexes
- [x] grammY topic wrappers (`createForumTopic`, `editForumTopic`, `closeForumTopic`)
- [x] `getOrCreateLeadTopics` — idempotent (unique constraint + ON CONFLICT DO NOTHING + re-select)
- [x] Wire into lead-creation paths — fire-and-forget, guarded, skip if no group
- [x] Title builders (leadName fallback: email local-part → "Visiteur"; listingTitle from getListing)
- [x] typecheck clean

## Tests Status

- Typecheck: pass (0 errors)
- Unit tests: pass (40/40)
- Agent tests: pass (226/226)

## Idempotency / Concurrency

Unique constraint `(group_chat_id, lead_id)` + `ON CONFLICT DO NOTHING` + re-select covers concurrent webhook retries. Rare orphan topic on mid-flight crash (topics created, insert aborted) is noted in code comment — reconciliation by name lookup deferred (YAGNI v1).

## Open Risk (red-team M3)

Telegram supergroup max-topics ceiling is unverified. At the stated scale (<100 active leads/agency) topic-per-lead is fine for v1. Verify against Telegram docs before deploying to high-volume agencies.

## Next Steps

Phase 04 can now use `getLeadTopicsByConversationTopic` / `getLeadTopicsByAssistantTopic` for reverse routing of inbound group messages by `message_thread_id`.

---

**Status:** DONE
**Summary:** Schema table + CRUD + grammY wrappers + orchestration + fire-and-forget wiring all implemented. Typecheck clean, 40 unit + 226 agent tests green.
