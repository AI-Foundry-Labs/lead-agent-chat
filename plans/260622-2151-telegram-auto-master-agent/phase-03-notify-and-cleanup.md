# Phase 03 — Redirect notify/handoff → Master + gỡ per-lead topic callers

**Priority:** P1 · **Status:** pending · **Depends:** 02

## Overview
Notify lead mới / handoff / takeover **đẩy thẳng (proactive)** vào 🛠 Master topic ngay khi
xảy ra — admin thấy luôn, KHÔNG cần slash command. Gỡ caller `getOrCreateLeadTopics` (đã
no-op) + tắt mirror per-lead (`reportTurnToTopic`).

## Related code files
**Modify:**
- `lib/telegram/notify-agency.ts` — post vào `agency.telegram_master_topic_id` (threadId)
  qua `enqueueGroupSend`; bỏ phụ thuộc per-lead topic.
- `lib/agent/run.ts` — bỏ/điều hướng `reportTurnToTopic` (mirror lead↔agent) → no-op hoặc
  notify gọn vào Master (theo "gửi thẳng vào master agent").
- Gỡ call `getOrCreateLeadTopics` (đã trả null) tại:
  `app/api/auth/google/callback/route.ts`, `app/api/auth/lead-request-link/route.ts`,
  `app/api/email/route.ts`, `lib/agent/tools/context.ts`,
  `lib/telegram/ensure-lead-for-conversation.ts`, `lib/telegram/promote-anonymous-visitor.ts`.

**Delete (nếu hết caller):**
- `lib/telegram/lead-topics.ts`, `lib/agent/report-turn-to-topic.ts`,
  `lib/telegram/sync-lead-topic-titles.ts`, `lib/agent/tools/main-assistant/telegram.ts`
  (xác minh từng cái — một số có thể còn tool main_assistant tham chiếu).

## Implementation steps
1. **notify-agency:** thêm `threadId = agency.telegram_master_topic_id ?? undefined` vào
   `enqueueGroupSend` để notify rơi vào Master topic. Verify chữ ký `enqueueGroupSend` hỗ trợ threadId.
2. **Mirror:** trong `run.ts`, gỡ block `reportTurnToTopic` (per-lead). Nếu muốn giữ
   thông báo lead-turn → gửi gọn 1 dòng vào Master (tùy, mặc định: tắt để tránh spam).
3. **Gỡ no-op callers** `getOrCreateLeadTopics` (6 nơi) + import liên quan.
4. **Xóa file mồ côi** sau khi grep sạch. Kiểm tra `main-assistant/telegram.ts` &
   `main-assistant/messaging.ts` có tool dùng lead-topics không — nếu có, cập nhật để
   không phụ thuộc per-lead (dùng Master topic / DM admin).
5. `grep` còn lại: `lead_telegram_topics`, `getOrCreateLeadTopics`, `reportTurnToTopic`,
   `lead-telegram-topics`. Bảng DB `lead_telegram_topics` giữ lại (không drop — YAGNI/an toàn migration), chỉ ngừng ghi.

## Todo
- [ ] notify-agency → Master topic threadId
- [ ] Gỡ mirror per-lead trong run.ts
- [ ] Gỡ 6 caller getOrCreateLeadTopics
- [ ] Rà main_assistant tools dùng lead-topics
- [ ] Xóa file mồ côi (đã grep sạch)
- [ ] `npm run typecheck` + `npm run build`

## Success criteria
- Lead mới / handoff → notification xuất hiện trong 🛠 Master topic.
- Không còn ghi `lead_telegram_topics`; không tạo forum topic per-lead.
- Build + typecheck pass.

## Risks
- `main_assistant` có tool gửi tin vào per-lead topic (telegram.ts/messaging.ts) → phải
  điều hướng, nếu không tool sẽ gãy. Rà kỹ trước khi xóa.
- `enqueueGroupSend` chưa nhận threadId cho notify → kiểm tra signature (group-send-queue.ts).
