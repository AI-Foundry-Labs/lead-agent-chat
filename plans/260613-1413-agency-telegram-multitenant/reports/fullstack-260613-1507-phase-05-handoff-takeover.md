# Phase 05 Implementation Report — Handoff + Dual Takeover

## Executed Phase
- Phase: phase-05-handoff-and-dual-takeover
- Plan: plans/260613-1413-agency-telegram-multitenant
- Status: completed

## Files Modified

| File | Change |
|------|--------|
| `lib/telegram/notify-agency.ts` | **CREATED** — agency-scoped notification (Topic 1 + General) |
| `lib/agent/run.ts` | Replace global `notifyAdmins` with `notifyAgency`; manual-mode + handoff branches |
| `lib/notify.ts` | No change; `notifyAdminsInChat` kept for web admin panel (already scoped per-admin) |
| `lib/telegram/handle-lead-telegram-update.ts` | Fill stub `handleAgencyTakeoverMessage`; add imports |
| `lib/dispatch.ts` | Extend `mirrorLeadTurnToTopic` to accept `'admin'` role; prefix "Conseiller"; admin sends as `kind:'critical'` |
| `app/api/admin/actions/route.ts` | `send_reply` mirrors to Topic 1; `takeover`/`release` post bilingual notices + idempotent mode flip |

## Tasks Completed
- [x] `notifyAgency(agencyId, leadId, summary)` — resolves agency.telegram_group_chat_id + lead topic mapping; posts into Topic 1 (if mapping exists) AND General; falls back to console log; never throws
- [x] `run.ts` handoff branch: replaced `notifyAdmins` with `notifyAgency` with bilingual FR/EN summary
- [x] `run.ts` manual-mode branch: replaced `notifyAdmins` with `notifyAgency`; kept `notifyAdminsInChat` for web panel
- [x] `handleAgencyTakeoverMessage`: resolveAgencyAdmin gate → bilingual rejection hint; `/resume` command; idempotent mode flip; `addMessage(role='admin')`; `dispatchReply`; `broadcastConversationUpdate`; no echo back into Topic 1
- [x] Web admin replies (`send_reply` action): `mirrorLeadTurnToTopic(conv, 'admin', content)` fire-and-forget with error log
- [x] Web `takeover` action: idempotent (set only if mode !== 'manual'); notifyAgency bilingual notice
- [x] Web `release` action: idempotent (set only if mode !== 'agent'); notifyAgency bilingual notice
- [x] `mirrorLeadTurnToTopic` extended to `'lead' | 'agent' | 'admin'`; admin → prefix "Conseiller"; admin kind='critical'

## Handoff Flow

```
Lead sends message → matchRule triggers
  → updateLead(status='handoff')
  → notifyAgency(agency_id, lead_id, bilingual summary)
      → enqueueGroupSend(groupChatId, summary, { threadId: topic1, kind:'critical' })
      → enqueueGroupSend(groupChatId, summary, { kind:'critical' })  // General
  → agent continues responding (handoff is a notify-only event; mode stays 'agent')
```

## Takeover-from-Telegram Flow (Topic 1)

```
Admin types in Topic 1
  → routeGroupMessage → topic1_conversation → handleAgencyTakeoverMessage
  → resolveAgencyAdmin(from.id, agency_id)
      → null → rejection hint in Topic 1 (kind:'critical') → STOP
  → load conv = getConversation(mapping.lead_conversation_id)
  → text === '/resume':
      → updateConversation(mode='agent') if ≠ agent
      → enqueueGroupSend(resumeNotice, kind:'critical') into Topic 1
      → broadcastConversationUpdate
  → any other text:
      → if conv.mode !== 'manual': updateConversation(mode='manual') + takeoverNotice into Topic 1
      → addMessage(role='admin', content=text)
      → dispatchReply(conv, text)  → customer's real channel (email/telegram DM/web SSE)
      → broadcastConversationUpdate  → web admin panel refreshes
      → (no echo into Topic 1 — admin sees their own message already)
```

## Takeover-from-Web Flow

```
Admin clicks "Take over" → POST /api/admin/actions { kind:'takeover' }
  → resolveVisitorThread(conversation_id)
  → if mode !== 'manual': updateConversation(mode='manual') + notifyAgency(takeoverNotice)
  → broadcastConversationUpdate

Admin types reply → POST /api/admin/actions { kind:'send_reply', content }
  → addMessage(role='admin', content)
  → dispatchReply(conv, content)    → customer channel
  → mirrorLeadTurnToTopic(conv, 'admin', content)  → Topic 1 (prefix "Conseiller:", kind:'critical')
  → broadcastConversationUpdate

Admin clicks "Return to Agent" → POST /api/admin/actions { kind:'release' }
  → if mode !== 'agent': updateConversation(mode='agent') + notifyAgency(resumeNotice)
  → broadcastConversationUpdate
```

## Mode SoT Reasoning

`conversations.mode` is the single DB field both surfaces read/write. All flips are idempotent (set-if-different checked before `updateConversation`). No separate state exists anywhere. Web and Telegram read the same row; concurrent flips are last-write-wins which is acceptable (race window is sub-second and both actors intent the same direction).

## Web Path Found + Wired

`app/api/admin/actions/route.ts` — three cases:
- `takeover`: set mode='manual', notifyAgency (was missing both)
- `release`: set mode='agent', notifyAgency (was missing both)
- `send_reply`: addMessage + dispatchReply already existed; added `mirrorLeadTurnToTopic(conv, 'admin', content)`

No web "return to agent" button path was absent — `release` case already existed, just lacked the Topic 1 notice. Wired.

## Tests Status
- `npm run typecheck`: **PASS** (clean, 0 errors)
- `npm run test`: **PASS** (47/47)
- `npm run test:agent`: **PASS** (226/226)

## Unresolved Questions
- None. All spec items implemented.

---

**Status:** DONE
**Summary:** Phase 05 complete — agency-scoped handoff notifications, Telegram Topic 1 takeover + /resume, web admin reply mirroring into Topic 1, dual-surface mode flip with `conversations.mode` as single SoT.
