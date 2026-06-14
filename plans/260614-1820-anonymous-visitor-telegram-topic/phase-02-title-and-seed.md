# Phase 02 — Title Số Thứ Tự + Seed Message Ngữ Cảnh + Mirror Lịch Sử

## Overview
- **Priority:** High
- **Status:** pending
- **Description:** Topic của visitor ẩn danh dùng **số thứ tự** (`Visiteur #18 — Marais 2BR`),
  và sau khi topic được tạo, **mirror lại các tin nhắn đã có** (2 tin trước ngưỡng) vào Topic 1
  để agency thấy đầy đủ ngữ cảnh, không mất đoạn đầu hội thoại.

## Key Insights
- Title builder hiện tại (`lead-topics.ts:40`) fallback `"Visiteur"` trơn → nhiều visitor cùng
  listing trùng tên topic. Số thứ tự giải quyết.
- Mirror hiện chỉ đẩy **turn đang chạy** (`run.ts:104,267`). Khi promote sau tin thứ 2, 2 tin đầu
  (và reply) đã **bỏ lỡ mirror** vì lúc đó chưa có topic → cần backfill 1 lần khi tạo topic.
- Send-queue đã throttle (~20 msg/min, drop-oldest-mirror). Backfill vài tin/visitor an toàn ở
  scale nhỏ (<100 lead/agency). Mark backfill `kind:'mirror'` (droppable) trừ tin đầu seed.

## Requirements
**Functional**
- `buildLeadDisplayName` nhận thêm `anonSeq?: number`: nếu không có name/email và có anonSeq →
  `Visiteur #{anonSeq}`; vẫn fallback `Visiteur` khi thiếu cả hai.
- Khi promote tạo topic xong: post 1 **seed message** vào Topic 1 với ngữ cảnh:
  listing đang xem, ngôn ngữ, giờ bắt đầu (nếu có).
- Mirror toàn bộ message visible hiện có của conversation (theo thứ tự) vào Topic 1 đúng 1 lần.

**Non-functional**
- Không double-mirror: chỉ backfill trong luồng tạo-topic-lần-đầu, không lặp ở turn sau.
- Best-effort, guarded.

## Architecture
```
buildLeadDisplayName(name, email, anonSeq?):
  name? → name
  email? → local-part
  anonSeq? → `Visiteur #${anonSeq}`
  else → 'Visiteur'

getOrCreateLeadTopics: đọc lead.anon_seq → truyền vào buildLeadDisplayName.

promoteAnonymousVisitor (Phase 01) mở rộng:
  topics = await getOrCreateLeadTopics(...)
  if topics created lần đầu (mapping mới):
    · enqueueGroupSend(seed: "📋 Visiteur #N • Listing: X • Lang: fr • 14:05", kind:'critical')
    · for each visible message: mirrorLeadTurnToTopic(conv, role, content)  // backfill
```
> Lưu ý: `getOrCreateLeadTopics` cần báo "vừa tạo mới" vs "đã tồn tại" để chỉ backfill 1 lần
> (trả thêm cờ, hoặc kiểm tra mapping trước/sau). Đơn giản nhất: promote tự check
> `getLeadTopicsByLead` trước gọi; nếu trước=null và sau!=null → backfill.

## Related Code Files
**Modify**
- `lib/telegram/lead-topics.ts` — `buildLeadDisplayName(... anonSeq?)`; truyền `lead.anon_seq`.
- `lib/telegram/promote-anonymous-visitor.ts` — seed message + backfill mirror (chỉ khi mới tạo).
- `lib/dispatch.ts` — (nếu cần) export helper build seed text; tái dùng `enqueueGroupSend`.

**Read for context**
- `lib/agent/run.ts` (mirror gọi ở đâu), `lib/telegram/group-send-queue.ts` (kind/throttle).

## Implementation Steps
1. Sửa `buildLeadDisplayName` thêm tham số `anonSeq?`; cập nhật 2 call site title builder.
2. `getOrCreateLeadTopics`: lấy `lead.anon_seq`, truyền vào display name.
3. Trong `promoteAnonymousVisitor`: snapshot `before = getLeadTopicsByLead`; sau
   `getOrCreateLeadTopics`, nếu `before==null && after!=null` → seed + backfill.
4. Seed text builder: listing title (nếu có), `lead.language`, giờ (từ conversation.created_at).
5. Backfill: `getVisibleMessages(conv.id)` → mirror tuần tự (map role user→'lead', assistant→'agent').
6. `npm run typecheck` + `npm run build`.

## Todo List
- [ ] `buildLeadDisplayName(anonSeq?)` + call sites
- [ ] `getOrCreateLeadTopics` truyền anon_seq
- [ ] seed message ngữ cảnh (listing/lang/giờ)
- [ ] backfill mirror các tin đã có (chỉ khi topic mới tạo)
- [ ] typecheck + build clean

## Success Criteria
- Topic visitor ẩn danh hiển thị `💬 Visiteur #N — {listing}`.
- Mở topic thấy: seed context + đủ 2 tin đầu (lead + agent) + các turn sau realtime.
- Không có tin nào bị mirror 2 lần.

## Risk Assessment
- **Medium:** backfill chạy lại nếu promote gọi 2 lần. Mitigation: guard before/after mapping
  (chỉ backfill khi chuyển null→non-null) + idempotent topic insert.
- **Low:** burst send khi backfill nhiều tin. Scale nhỏ ⇒ chấp nhận; queue đã throttle.

## Security Considerations
- Seed/backfill chỉ đẩy nội dung của chính conversation đó; topic scoped theo agency (đã có).

## Next Steps
- (Follow-up, ngoài scope) auto-archive topic của visitor thoát ngay; rate-limit chống spam topic.
