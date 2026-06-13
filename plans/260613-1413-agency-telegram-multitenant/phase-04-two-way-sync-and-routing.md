# Phase 04 — Two-Way Message Sync + Topic Routing

## Overview
- **Priority:** Critical
- **Status:** completed
- **Description:** Mirror lead↔agent turns into Topic 1, run the copilot in Topic 2, and route inbound agency-group messages to the right handler by `message_thread_id`.

## Key Insights
- Outbound mirroring extends existing `dispatchReply` / `dispatchUserMessage` (currently target admin DM) to target the agency group + topic.
- Inbound routing is the new core: one webhook, branch by `chat.type` and `message_thread_id`. **handle-lead-telegram-update.ts has NO group/`message_thread_id` handling today** — this whole branch is net-new (not "extend"), so treat as higher risk.
- The lead's *own* channel (web/email/lead-DM) is unchanged — Topic 1 is an **additional** mirror, not the lead's primary channel.

## ⚠️ Telegram rate limit (red-team C1 — load-bearing)
Telegram caps a bot at **~20 messages/minute per group** (hard 429). Mirroring every agent reply for many concurrent leads into ONE shared agency supergroup blows this in seconds. v1 mitigations:
- **Mirror policy:** mirror lead inbound + the **final** agent reply per turn (one message, NOT token-streamed) + handoff/takeover events. Do not mirror intermediate tool chatter.
- **Per-group send queue** (`lib/telegram/group-send-queue.ts`): throttle to stay under the cap; on 429 back off; **drop-policy = drop oldest *mirror* messages, never drop handoff/takeover/operator-reply messages.** Log drops.
- Accept that Topic 1 is a best-effort mirror; the lead's real channel + web `/admin` remain the sources of truth.

## Requirements
**Functional**
- Lead message (web) → also posted into Topic 1 as "Lead: …".
- Agent auto-reply → posted into Topic 1 (so agency sees the synced convo) AND delivered to lead's real channel (existing behavior).
- Message in **Topic 1** from a human admin → treated as **takeover to customer** (Phase 05 owns mode flip + send).
- Message in **Topic 2** → run an `operator` agent turn scoped to that lead; reply posted back into Topic 2 only (never to customer).
- Message in **General** or unknown thread → ignore or treat as agency-wide command.

**Non-functional**
- Must not echo: bot's own posts into Topic 1 must not be re-ingested as admin takeover (filter `from.is_bot`).
- Idempotent on webhook retry (Telegram resends).

## Architecture
```
handleTelegramUpdate(update):
  if chat.type private  → existing lead-DM/admin flows (untouched)
  if chat.type group/supergroup:
     thread = message.message_thread_id
     if text.startsWith('/link')          → handleAgencyGroupLink (Phase 02)
     resolve mapping by (chat.id, thread):
        match conversation_topic_id → TOPIC 1 → handleAgencyTakeoverMessage (Phase 05)
        match assistant_topic_id    → TOPIC 2 → handleOperatorTopicMessage
        else (General/none)         → handleAgencyGeneral (noti ack / ignore)

Outbound (extend lib/dispatch.ts):
  mirrorLeadTurnToTopic(conversation, role, content):
     · look up lead_telegram_topics by lead conversation
     · sendMessage(group, message_thread_id=conversation_topic_id, "Lead/Agent: …")
```

## Related Code Files
**Modify**
- `lib/telegram/handle-lead-telegram-update.ts` — add group branch + thread routing; `handleOperatorTopicMessage`.
- `lib/dispatch.ts` — `mirrorLeadTurnToTopic` for lead + agent turns; keep existing email/telegram lead delivery.
- `lib/agent/run.ts` — after persisting lead user msg and agent reply, call mirror (guarded).
- `lib/telegram.ts` — ensure `sendTelegramMessage` supports `message_thread_id`.

**Create**
- `lib/telegram/route-group-message.ts` — pure router: (chatId, threadId) → {kind, mapping}.
- `lib/telegram/group-send-queue.ts` — per-group throttle + 429 backoff + drop-oldest-mirror policy (C1).

## Implementation Steps
1. Extend `sendTelegramMessage` to accept optional `message_thread_id`; route ALL group sends through the per-group send queue (C1).
2. `mirrorLeadTurnToTopic(conv, role, content)` — resolve topic, post with role prefix; guard + log on failure. Mirror final reply only (not streamed tokens).
3. Call mirror from `run.ts` for (a) inbound lead user message and (b) the final outbound agent reply.
4. Add group branch to `handleTelegramUpdate`; **reject if `chat.id` ∉ registered agency groups** (I4). Build `route-group-message.ts` reverse lookup by topic id.
5. `handleOperatorTopicMessage(mapping, sender, text)`: resolve `adminId` via `resolveAgencyAdmin(sender.id, mapping.agency_id)` (Phase 02) — **unmapped → reject with hint, do NOT fallback** (C2). Then `runAgentTurn(operator_conversation_id, text, {type:'operator', leadId, adminId, adminName})`; post reply into Topic 2 only.
6. **Idempotency (I1):** dedupe inbound by Telegram `update_id` (in-memory LRU or short-TTL store); treat ONLY human Topic-1 messages (`from.is_bot===false`) as takeover; bot's own mirror posts ignored.
7. `npm run typecheck`.

## Todo List
- [x] `sendTelegramMessage` thread support
- [x] `mirrorLeadTurnToTopic` + wire into run.ts (in + out)
- [x] Group branch + `route-group-message.ts`
- [x] `handleOperatorTopicMessage` (operator turn → Topic 2)
- [x] Bot-echo filtering
- [x] typecheck clean

## Success Criteria
- Web conversation appears live in Topic 1; agent replies show in both Topic 1 and lead's channel.
- Typing in Topic 2 yields a copilot reply in Topic 2 only — never reaches the customer.
- No infinite echo; webhook retries don't double-post.

## Risk Assessment
- **High:** echo loop (bot post → ingested as admin msg → re-dispatched). Mitigation: `is_bot` filter + only treat Topic 1 human messages as takeover.
- **Medium:** `operator` turn needs an `adminId`/`adminName`; group messages come from a Telegram user → map sender to an admin of the agency, fallback to agency's primary admin.
- **Medium:** message ordering across web + topic. Acceptable; timestamps preserved.

## Security Considerations
- Reverse lookup strictly scoped by `chat.id` → mapping `agency_id`; a thread id alone never resolves cross-agency.
- Sender in group must be a member; only recognized agency admins can drive operator/takeover (else ignore + hint).

## Next Steps
- Phase 05 implements takeover semantics for Topic 1 + dual web/Telegram sync.
