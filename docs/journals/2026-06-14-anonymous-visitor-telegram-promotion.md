# Anonymous Visitor Telegram Promotion

**Date**: 2026-06-14 18:44
**Severity**: Medium
**Component**: Chat API, Lead Management, Telegram Integration
**Status**: Resolved

## What Happened

Shipped feature to auto-create leads and Telegram topics for anonymous (logged-out) web visitors who ask questions. Previously, anonymous visitors had no lead row in the database, so their conversations never reached the agency's Telegram group — the agency saw zero visibility into unregistered visitor inquiries.

## The Brutal Truth

This was a significant blind spot. Anonymous visitors could spend 5+ turns asking questions, and the sales team would never know they existed. The booking/qualification flow only triggered when visitors explicitly used a tool, which anonymous users rarely did. The system silently dropped conversations.

## Technical Details

**Root cause**: `mirrorLeadTurnToTopic` returned early on null `lead_id`. Lead creation was lazy — only happened via `ensureLead` when a tool was invoked. Anonymous users asking questions without triggering tools never got a lead row.

**Solution**: After each lead turn in `app/api/chat/route.ts`, check if conversation is still anonymous AND has ≥2 user messages. If yes, call `promoteAnonymousVisitor` (new module: `lib/telegram/promote-anonymous-visitor.ts`):

1. Reserve per-agency sequence number (new column: `agencies.anon_seq_counter`)
2. Create anonymous lead with `anon_seq` set (new column: `leads.anon_seq`)
3. Attach lead to conversation (conditional UPDATE to prevent race)
4. Provision existing per-lead forum topics via `getOrCreateLeadTopics`
5. Post context header + backfill prior conversation messages into 💬 Conversation topic
6. Visitor shows as `Visiteur #18` in Telegram (agency-specific sequence, not hash)

**Threshold choice**: ≥2 user messages before promotion, not on first message — reduces spam from visitors who bounce immediately.

**Concurrency**: Real race condition surfaced in code review — two parallel turns on same anonymous conversation could both trigger promotion, creating duplicate leads + orphaned Telegram topics. Fixed with:
- `attachLeadIfAnonymous`: UPDATE with WHERE lead_id IS NULL condition — only first writer wins
- Loser checks attachment result; if failed, calls `deleteLead` on its created lead and bails before topic provisioning

No new conversation types, no new tables — reused all existing lead topic infrastructure.

## Schema Changes

- `agencies.anon_seq_counter` (int default 0) — per-agency sequence generator
- `leads.anon_seq` (int nullable) — stores anonymous visitor number

Applied via psql (interactive; `db:push` not used on non-empty database).

## Testing

- 160 unit tests, 6 new cases for anonSeq title formatting
- 263 agent tests
- All green
- typecheck + build: clean

## Lessons Learned

**Lazy initialization patterns have blind spots.** If a resource (lead) only gets created on user action (tool invocation), passive interactions (asking questions) fly invisible. Future features should consider minimum signal thresholds upfront, not bolt them on later.

**Concurrency isn't theoretical in feature flags.** The race condition felt unlikely until code review forced the scenario: two parallel requests on the same conversation. UPDATE ... WHERE conditions are cheap insurance.

**Sequence numbers beat hashes for agency UX.** `Visiteur #5` is better than `Visiteur #a7f2c1` — easier to reference in Slack, less noise in logs, still scannable in long Telegram threads.

## Next Steps

- Monitor anon_seq_counter growth across agencies (should be steady, not spikey)
- Watch for edge case: what if visitor signs up mid-conversation? (Separate feature, not blocking)
- Future: extend to upsell suggestions in Telegram (e.g., "suggest booking call" prompt after 3 messages)

---

**Files Modified**: 
- `app/api/chat/route.ts`
- `lib/telegram/promote-anonymous-visitor.ts` (new)
- Database schema

**Test Results**: All passing (160 unit + 263 agent)
**Build Status**: Clean
