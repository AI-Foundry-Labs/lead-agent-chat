# Phase 01 — Anon Lead Seq + Tạo Topic Sau Tín Hiệu Tối Thiểu

## Overview
- **Priority:** High
- **Status:** pending
- **Description:** Tạo lead ẩn danh + 2 forum topic cho visitor **chưa đăng nhập** sau khi đạt
  ngưỡng tín hiệu tối thiểu (≥2 tin nhắn lead trong conversation). Cấp số thứ tự per-agency atomically.

## Key Insights
- Hạ tầng topic đã hoàn chỉnh (`getOrCreateLeadTopics`, `lead_telegram_topics`, send-queue, routing).
  Phase này chỉ thêm **trigger mới** + **counter**, không build lại gì.
- `getOrCreateLeadTopics` đã tự skip khi agency chưa link group / `telegram_topics_enabled=false`
  → an toàn cho agency chưa cấu hình.
- Counter phải atomic để tránh trùng số dưới concurrency: dùng
  `UPDATE agencies SET anon_seq_counter = anon_seq_counter + 1 ... RETURNING anon_seq_counter`.
- Ngưỡng đếm = số message role `user` đã visible trong conversation (đã có `getVisibleMessages`).
- Chỉ chạy nhánh này khi `conversation.lead_id` vẫn null sau turn (tránh đè nhánh `ensureLead`).

## Requirements
**Functional**
- Sau mỗi lead turn, nếu `conversation.lead_id == null` và `count(user messages) >= 2`:
  tạo lead ẩn danh, cấp số thứ tự, attach vào conversation, gọi `getOrCreateLeadTopics`.
- Số thứ tự lưu trên lead để Phase 02 build title (cột `anon_seq` trên `leads`).
- Idempotent: gọi nhiều lần không tạo nhiều lead / không tăng counter thừa.

**Non-functional**
- Off response-path: không block reply web; lỗi Telegram chỉ log, không throw.
- Atomic counter, không race.

## Architecture
```
agencies
  + anon_seq_counter int NOT NULL default 0   -- bộ đếm visitor ẩn danh / agency

leads
  + anon_seq int  (nullable)                  -- số thứ tự gán khi promote; null nếu lead có tên/email

promoteAnonymousVisitor(conversation, agencyId):
  · nếu conversation.lead_id != null → return (đã có lead)
  · nextSeq = UPDATE agencies SET anon_seq_counter = anon_seq_counter + 1
              WHERE id=agencyId RETURNING anon_seq_counter
  · lead = createLead({ agency_id, channel, listing_id, anon_seq: nextSeq })
  · updateConversation(conv.id, { lead_id: lead.id })
  · getOrCreateLeadTopics(agencyId, lead.id)   // fire-and-forget, guarded
  · return lead

route.ts POST (sau runAgentTurn, khi !leadId và refreshed.lead_id vẫn null):
  · userMsgCount = đếm message role 'user' của conv
  · if userMsgCount >= 2 → void promoteAnonymousVisitor(conv, agencyId).catch(log)
```

## Related Code Files
**Modify**
- `lib/db/schema.ts` — `agencies.anon_seq_counter`, `leads.anon_seq`.
- `lib/db/leads.ts` — `createLead` nhận `anon_seq?`; `rowToLead` map field; type `Lead` (lib/types).
- `lib/db/agencies.ts` — thêm `incrementAnonSeq(agencyId): Promise<number>` (atomic RETURNING).
- `app/api/chat/route.ts` — sau turn, nhánh đếm message + gọi promote (chỉ khi vẫn anonymous).

**Create**
- `lib/telegram/promote-anonymous-visitor.ts` — `promoteAnonymousVisitor(conv, agencyId)`.
  (Tách riêng theo modularization rule; tái dùng pattern của `ensure-lead-for-conversation.ts`.)

## Implementation Steps
1. Schema: thêm `anon_seq_counter` (agencies) + `anon_seq` (leads). `npm run db:push`.
2. `lib/types`: thêm `anon_seq: number | null` vào `Lead`. Update `rowToLead`.
3. `createLead`: nhận `anon_seq?: number | null`, insert.
4. `agencies.ts`: `incrementAnonSeq` dùng `db.update(...).returning({ seq: agencies.anon_seq_counter })`.
5. Tạo `promote-anonymous-visitor.ts` theo Architecture (guarded, fire-and-forget topic).
6. `route.ts`: sau block refresh lead (dòng ~148-155), thêm: nếu vẫn anonymous, đếm
   `getVisibleMessages(conv.id)` role user ≥2 → `void promoteAnonymousVisitor(conv, agencyId)`.
7. `npm run typecheck` + `npm run build`.

## Todo List
- [ ] `agencies.anon_seq_counter` + `leads.anon_seq` schema + db:push
- [ ] `Lead` type + `rowToLead` + `createLead(anon_seq)`
- [ ] `incrementAnonSeq` atomic
- [ ] `promoteAnonymousVisitor` module
- [ ] wire vào `route.ts` (ngưỡng ≥2 user messages, chỉ khi anonymous)
- [ ] typecheck + build clean

## Success Criteria
- Visitor ẩn danh gửi ≥2 tin → 1 cặp topic xuất hiện trong group agency (nếu đã link + enabled).
- Counter tăng đúng, không trùng số dưới 2 request đồng thời.
- Agency chưa link group → web vẫn chạy, không lỗi, không topic.
- Gửi tin thêm không tạo lead/topic lần 2 (idempotent qua `lead_id` đã set).

## Risk Assessment
- **Medium:** race tạo lead 2 lần nếu 2 turn song song cùng conversation. Mitigation: check
  `conversation.lead_id` mới nhất trong promote (re-read) trước khi tạo; topic insert đã idempotent.
- **Low:** counter gap khi promote fail sau increment. Chấp nhận (số thứ tự không cần liên tục).

## Security Considerations
- `incrementAnonSeq` scoped theo `agencyId` (đã resolve server-side, không nhận từ header client).
- Lead ẩn danh vẫn mang `agency_id` → mọi lookup topic scoped đúng tenant.

## Next Steps
- Phase 02: title số thứ tự + seed message ngữ cảnh + mirror 2 tin lịch sử vào Topic 1.
