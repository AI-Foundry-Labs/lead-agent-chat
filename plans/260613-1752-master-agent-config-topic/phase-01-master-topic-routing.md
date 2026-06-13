# Phase 01 — Master Topic trên Telegram → main_assistant

## Overview
- **Priority:** Critical
- **Status:** pending
- **Description:** Thêm 1 topic "🛠 Master" / agency trong group; nhắn vào đó → chạy `main_assistant` agent (đã có) để config/quản lý; reply post lại topic Master.

## Key Insights
- `main_assistant` conversation + tools đã tồn tại và chạy được trên Telegram (admin DM). Việc còn lại chỉ là **route 1 topic group → conversation main_assistant của agency**.
- Topic Master là **per-agency** (1 topic), khác topic per-lead. Lưu thread id trên `agencies`.
- `getOrCreateMainAssistant(adminId, agencyId)` cần `adminId` → dùng `resolveActingAdmin` (đã có, fallback primary admin) để lấy admin của agency.

## Related Code Files
**Modify**
- `lib/db/schema.ts` — thêm `agencies.telegram_master_topic_id` (integer, nullable).
- `lib/telegram/lead-topics.ts` hoặc bind flow (`handleAgencyGroupLink`) — tạo topic "🛠 Master — {agency}" 1 lần khi link group (hoặc lazy), lưu id.
- `lib/telegram/route-group-message.ts` — thêm `ThreadKind = 'master'`; classify khi `threadId === agency.telegram_master_topic_id`.
- `lib/telegram/handle-lead-telegram-update.ts` — nhánh `route.kind === 'master'` → `handleMasterTopicMessage`.
- `lib/db/agencies.ts` — getter trả master_topic_id (hoặc dùng agency row sẵn có).

**Create**
- `handleMasterTopicMessage(chatId, agency, fromId, text)` trong handle-lead-telegram-update.ts:
  - `admin = resolveActingAdmin(fromId, agency.id)`; null → báo "no admin".
  - `conv = getOrCreateMainAssistant(admin.id, agency.id)`.
  - `result = runAgentTurn(conv.id, text, {type:'main_assistant', adminId: admin.id, adminName: admin.name})`.
  - post `result.reply` vào topic Master (`enqueueGroupSend`, threadId=master_topic_id, kind:'critical').

## Implementation Steps
1. Schema: `telegram_master_topic_id integer` trên agencies + migration (`db:generate` → `db:migrate`).
2. Tạo topic Master: trong `handleAgencyGroupLink` sau khi bind group, `createForumTopic(chatId, '🛠 Master — '+agency.name)` → lưu id. (Idempotent: bỏ qua nếu đã có.)
3. Router: thêm kind `'master'` — lưu ý classify cần biết `master_topic_id` của agency (truyền vào `routeGroupMessage` từ agency đã resolve trong dispatcher).
4. Dispatcher: resolve agency (đã có `getAgencyByTelegramGroup`), nếu `msg.message_thread_id === agency.telegram_master_topic_id` → `handleMasterTopicMessage`. Đặt nhánh này TRƯỚC `routeGroupMessage` per-lead (master topic không nằm trong lead_telegram_topics).
5. Echo filter + update_id dedupe: tái dùng (đã có ở group branch).

## Todo List
- [ ] `agencies.telegram_master_topic_id` + migration
- [ ] Tạo topic Master khi link group (idempotent)
- [ ] Router kind 'master'
- [ ] `handleMasterTopicMessage` → main_assistant turn
- [ ] typecheck + test xanh

## Success Criteria
- Nhắn "thêm tiêu chí khu vực" / "tạo rule khi khách hỏi giảm giá" vào topic 🛠 Master → agent thực thi, DB đổi, reply trong topic.
- Topic Master không lẫn với topic per-lead; không echo.

## Risk
- **Medium:** master topic id trùng range với lead topic id → phải so theo `agency.telegram_master_topic_id` cụ thể, không đoán. Mitigation: check master TRƯỚC, exact match.

## Security
- Chỉ thành viên group (agency-private) dùng được; action attribute qua `resolveActingAdmin`. Tool config đã scope `ctx.config.agency_id`.

## Next
- Phase 02 (web auto-refresh) độc lập, chạy song song được.
