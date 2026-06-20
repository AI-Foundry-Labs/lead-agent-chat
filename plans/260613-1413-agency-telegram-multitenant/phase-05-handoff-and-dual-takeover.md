# Phase 05 — Handoff + Dual Takeover (web + Telegram)

## Overview
- **Priority:** Critical
- **Status:** completed
- **Description:** On handoff, notify the agency group (in the lead's Topic 1 + General). Let admins take over from **either** the Telegram topic or the web UI, with both kept in sync.

## Key Insights
- Handoff plumbing already exists in `run.ts`: rule match → `mode='manual'`, `notifyAdmins`, agent stops auto-replying. This phase **redirects** those notifications to the agency group and **adds** the Telegram→customer takeover path.
- "Takeover from both" = the conversation `mode` is the single source of truth; whoever flips it (web button or first admin message in Topic 1) wins, and subsequent admin messages from either surface relay to the customer.

## Requirements
**Functional**
- Handoff fires → post alert into the lead's Topic 1 **and** General topic of the agency group (replace global `notifyAdmins` fan-out with agency-scoped delivery).
- Admin message in **Topic 1** → if `mode==='agent'`, flip to `manual` (takeover); relay the admin text to the customer's real channel (web SSE / email / lead-DM) via `dispatchReply`.
- Web takeover (existing UI) still works; messages typed on web also mirror into Topic 1.
- A "return to agent" control (web button + `/resume` in Topic 1) flips back to `mode='agent'`.

**Non-functional**
- Single source of truth = `conversations.mode`; no split-brain between surfaces.

## Architecture
```
Handoff (run.ts):
   matched rule → updateLead(status='handoff'), conversation.mode='manual'
   notifyAgency(agencyId, leadId, summary):
      · post into Topic 1 (lead context) + General (agency-wide)
      · (web) broadcastConversationUpdate for the admin UI

Takeover via Telegram (Topic 1 inbound, Phase 04 routes here):
   handleAgencyTakeoverMessage(mapping, sender, text):
      · if conv.mode==='agent' → set 'manual' (+ notify "takeover by <admin>")
      · addMessage(lead conv, role='admin', content=text)
      · dispatchReply(lead conv, text)  → customer's real channel
      · broadcastConversationUpdate → web stays in sync

Takeover via web (existing): unchanged, plus mirrorLeadTurnToTopic for admin msgs.

Resume:
   web button OR '/resume' in Topic 1 → conv.mode='agent', notify both surfaces.
```

## Related Code Files
**Modify**
- `lib/notify.ts` — `notifyAgency(agencyId, …)` replacing/augmenting global `notifyAdmins`; resolve agency group + Topic 1/General.
- `lib/agent/run.ts` — handoff + manual-mode branches call `notifyAgency` (agency-scoped, not all admins).
- `lib/telegram/handle-lead-telegram-update.ts` — `handleAgencyTakeoverMessage`, `/resume` handling.
- `lib/dispatch.ts` — ensure admin takeover text mirrors to Topic 1 too.
- Admin web takeover handler (existing route/component) — mirror admin replies into Topic 1.

**Create**
- `lib/telegram/notify-agency.ts` — agency-scoped notification fan-out (group topics).

## Implementation Steps
1. Implement `notifyAgency(agencyId, leadId, summary)` → posts to Topic 1 + General; falls back to log if no group.
2. Swap `notifyAdmins`/`notifyAdminsInChat` calls in `run.ts` handoff + manual branches to agency-scoped delivery.
3. `handleAgencyTakeoverMessage`: flip mode if needed, persist `role='admin'`, `dispatchReply` to customer, broadcast to web.
4. Mirror web-side admin replies into Topic 1 (reuse `mirrorLeadTurnToTopic`).
5. Add `/resume` (Topic 1) + web "return to agent" → `mode='agent'` + dual notify.
6. Sender→admin resolution: map `from.id` to an agency admin; only admins may take over (else ignore + hint).
7. `npm run typecheck`.

## Todo List
- [x] `notifyAgency` (Topic 1 + General)
- [x] Redirect handoff/manual notifications to agency scope
- [x] `handleAgencyTakeoverMessage` (mode flip + relay + broadcast)
- [x] Web admin replies mirror to Topic 1
- [x] `/resume` + web return-to-agent
- [x] Sender→admin authorization
- [x] typecheck clean

## Success Criteria
- Handoff alert lands in the correct agency group (Topic 1 + General), not other agencies.
- Admin reply in Topic 1 reaches the customer and shows on web; web reply shows in Topic 1.
- Resume returns control to the agent on both surfaces.

## Risk Assessment
- **High:** split-brain if web and Telegram both flip mode concurrently. Mitigation: `mode` is the single DB source of truth; flips are idempotent (set-if-different).
- **Medium:** wrong-customer relay if mapping resolves incorrectly. Mitigation: relay strictly via mapping→lead conversation; never by raw thread id.

## Security Considerations
- Only authenticated agency admins (mapped from Telegram sender) can take over or resume.
- Agency-scoped notify prevents leaking lead messages to another tenant's group.

## Next Steps
- Phase 06: tests (incl. cross-tenant isolation + echo-loop), migration safety, docs.
