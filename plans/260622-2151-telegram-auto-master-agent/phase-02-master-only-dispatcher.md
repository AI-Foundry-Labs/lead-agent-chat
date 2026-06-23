# Phase 02 — Rút gọn group dispatcher: chỉ Master, gỡ per-lead routing

**Priority:** P1 · **Status:** pending · **Depends:** 01

## Overview
Bỏ routing per-lead trong group. Mọi message trong group (Master topic hoặc General) →
`handleMasterTopicMessage`. Gỡ nhánh `topic1_conversation` / `topic2_assistant`.

## Related code files
**Modify:**
- `lib/telegram/handle-lead-telegram-update.ts` — bỏ `routeGroupMessage` + 2 nhánh topic;
  chỉ giữ: `/link`, Master topic, General fallback (đều → `handleMasterTopicMessage`).

**Delete (sau khi hết caller):**
- `lib/telegram/route-group-message.ts`
- `handleConversationTopicMessage`, `handleOperatorTopicMessage` trong
  `lib/telegram/handle-group-telegram-message.ts` (giữ `handleMasterTopicMessage`, `handleAgentCallback`).

## Implementation steps
1. Trong group branch của `handleTelegramUpdate`: sau check Master topic, xóa khối
   `routeGroupMessage` + 2 nhánh. Mọi thread khác → `handleMasterTopicMessage` (đã là
   fallback hiện tại ở dòng ~211).
2. Gỡ import `routeGroupMessage`, `handleOperatorTopicMessage`, `handleConversationTopicMessage`.
3. Xóa file `route-group-message.ts` + 2 export không dùng trong `handle-group-telegram-message.ts`.
4. `grep` đảm bảo không còn caller: `classifyGroupThread`, `routeGroupMessage`,
   `handleConversationTopicMessage`, `handleOperatorTopicMessage`.

## Todo
- [ ] Bỏ per-lead routing trong dispatcher
- [ ] Xóa `route-group-message.ts`
- [ ] Xóa 2 handler topic per-lead
- [ ] grep sạch caller
- [ ] `npm run typecheck`

## Success criteria
- Message bất kỳ trong group đã bind → master agent trả lời (slash command + LLM).
- Không còn tham chiếu `lead_telegram_topics` trong đường group inbound.

## Risks
- Còn caller ẩn của 2 handler → grep kỹ trước khi xóa. Nếu test per-lead routing tồn tại → gỡ/cập nhật ở Phase 04.
