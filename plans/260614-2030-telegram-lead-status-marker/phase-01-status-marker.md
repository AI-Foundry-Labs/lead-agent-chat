# Phase 01 — Status Marker Helper + Hook vào lead-tools

## Overview
- **Priority:** High
- **Status:** pending
- **Description:** Khi `potential_status` đổi giá trị, đổi emoji đầu tên topic 💬 + post tin thông báo.

## Key Insights
- `editForumTopic(chatId, threadId, name)` đã có (telegram.ts:127), no-op an toàn nếu chưa config.
- `buildLeadDisplayName` + listing đã dùng để build title gốc — phải reuse để title nhất quán
  (tránh ghi đè mất tên/anon_seq). Helper tự load lead + listing.
- `enqueueGroupSend(chatId, text, {threadId, kind:'critical'})` để post tin (không bị drop).
- So sánh giá trị: caller có `lead.potential_status` (trước update) → truyền old + new vào helper.

## Requirements
**Functional**
- `syncLeadStatusToTelegram(agencyId, leadId, oldStatus, newStatus, reason)`:
  - old===new (hoặc new null) → return (no-op).
  - lookup topic; chưa có → return.
  - editForumTopic title 1 = `{emoji} {displayName} — {listing}`.
  - enqueue tin: `{emoji} Statut: {NEW_UPPER} — {reason}`.
- Hook vào `record_qualification` + `update_lead_status`: capture old trước updateLead, gọi helper sau.

**Non-functional**
- Off response-path, guarded (Telegram fail không vỡ turn). emoji: hot=🔥 warm=🟡 cold=❄️.

## Architecture
```
lib/telegram/lead-status-marker.ts
  STATUS_EMOJI = { hot:'🔥', warm:'🟡', cold:'❄️' }
  syncLeadStatusToTelegram(agencyId, leadId, old, next, reason):
    if !next || old === next: return
    topics = getLeadTopicsByLead(agencyId, leadId); if !topics?.conversation_topic_id: return
    lead = getLeadById(leadId); listing = getListing(lead.listing_id)
    name = buildLeadDisplayName(lead.name, lead.email, lead.anon_seq)
    base = buildConversationTopicTitle(name, listing?.title)   // "💬 X — Y"
    title = `${STATUS_EMOJI[next]} ${base}`                    // prepend emoji
    editForumTopic(topics.group_chat_id, topics.conversation_topic_id, title)
    enqueueGroupSend(group_chat_id, `${emoji} Statut: ${next.toUpperCase()} — ${reason}`,
                     {threadId: conversation_topic_id, kind:'critical'})
```

## Related Code Files
**Create**
- `lib/telegram/lead-status-marker.ts`

**Modify**
- `lib/agent/tools/lead-tools.ts` — `record_qualification` + `update_lead_status`: capture
  `lead.potential_status` trước `updateLead`, gọi helper sau (fire-and-forget, guarded).

## Implementation Steps
1. Tạo `lead-status-marker.ts` theo Architecture (reuse buildLeadDisplayName/buildConversationTopicTitle).
2. `record_qualification`: `const prev = lead.potential_status;` … sau update →
   `void syncLeadStatusToTelegram(agency_id, lead.id, prev, potential_status, reason).catch(log)`.
3. `update_lead_status`: chỉ gọi khi `potential_status !== undefined`; old = `lead.potential_status`,
   reason = `memory_note`.
4. typecheck + build.
5. Unit test: helper logic (emoji map, no-op khi old===new) — pure phần tách được; phần Telegram mock-skip.

## Todo List
- [ ] `lead-status-marker.ts`
- [ ] hook record_qualification
- [ ] hook update_lead_status
- [ ] typecheck + build
- [ ] unit test emoji/no-op

## Success Criteria
- Lead chuyển warm→hot → tên topic 💬 đổi sang `🔥 …` + tin `🔥 Statut: HOT — {reason}`.
- Agent gọi record_qualification cùng status cũ → không đổi gì (no spam).
- Agency chưa link group → web chạy bình thường, no-op.

## Risk Assessment
- **Low:** editForumTopic rate-limit nếu status đổi liên tục. Mitigation: chỉ push khi đổi giá trị.
- **Low:** title quá dài sau prepend emoji. Telegram cap ~128 ký tự; displayName/listing đã ngắn.

## Security Considerations
- Helper scoped theo agencyId (resolve server-side); topic lookup scoped tenant.

## Next Steps
- (Follow-up) marker cho admin-side status changes (operator/main_assistant) nếu cần.
