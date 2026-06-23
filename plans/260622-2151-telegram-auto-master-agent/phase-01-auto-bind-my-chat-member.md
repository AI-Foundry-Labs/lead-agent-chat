# Phase 01 — Auto-bind qua `my_chat_member` + webhook allowed_updates

**Priority:** P0 · **Status:** pending · **Depends:** —

## Overview
Khi bot được cấp quyền admin trong supergroup, Telegram gửi update `my_chat_member`.
Bắt event này → resolve agency qua người thao tác → bind group + tạo 🛠 Master, KHÔNG cần token.

## Key insight
- `handleAgencyGroupLink` đã có sẵn flow bind + tạo Master. Tách phần dùng chung thành
  `bindAgencyGroupAndEnsureMaster(agencyId, chat)` để cả `/link` và `my_chat_member` gọi.
- `TelegramUpdate` chưa có `my_chat_member` → thêm field.
- Webhook `allowed_updates` thiếu `my_chat_member` → bot KHÔNG nhận được nếu không sửa.

## Related code files
**Modify:**
- `lib/telegram-router-types.ts` — thêm `my_chat_member` vào `TelegramUpdate`.
- `lib/telegram/handle-lead-telegram-update.ts` — tách helper + thêm nhánh `my_chat_member`.
- `scripts/set-webhook.ts` — `allowed_updates: ['message', 'my_chat_member']`.
- `scripts/telegram-dev.ts` — thêm `'my_chat_member'` vào dev long-poll.

**Create:**
- `lib/telegram/bind-agency-group.ts` — helper `bindAgencyGroupAndEnsureMaster` + nhánh
  `handleBotPromotedToAdmin` (resolve agency qua `from.id`, verify, bind).

## my_chat_member shape (đọc tối thiểu)
```ts
my_chat_member?: {
  chat?: { id?: number|string; type?: string };
  from?: { id?: number|string };           // người thay đổi quyền bot
  new_chat_member?: { status?: string };    // 'administrator' khi được cấp admin
  old_chat_member?: { status?: string };
};
```

## Implementation steps
1. **Types:** thêm `my_chat_member` (shape trên) vào `TelegramUpdate`.
2. **Tách helper** `bindAgencyGroupAndEnsureMaster(agencyId, chat)` từ thân
   `handleAgencyGroupLink` (phần sau `consumeAgencyTelegramLink`): verify group → `bindTelegramGroupToAgency`
   → tạo 🛠 Master nếu `telegram_master_topic_id === null` → gửi message xác nhận.
   `handleAgencyGroupLink` giữ phần consume token rồi gọi helper (DRY).
3. **Nhánh promote** `handleBotPromotedToAdmin(update)`:
   - Chỉ xử lý khi `new_chat_member.status === 'administrator'/'creator'` &&
     `old_chat_member.status` không phải admin (tránh chạy lặp).
   - `chat.type === 'supergroup'`. `fromId = my_chat_member.from.id`.
   - `admin = getAdminByTelegramUserId(fromId)`; nếu null → gửi vào group hướng dẫn:
     "DM bot `/start <token>` để link tài khoản rồi cấp lại quyền, hoặc gửi `/link <token>`."
   - Nếu có admin → `bindAgencyGroupAndEnsureMaster(admin.agency_id, chat)`.
   - Idempotent: nếu group đã bind đúng agency → chỉ đảm bảo Master tồn tại, không bind lại.
4. **Dispatcher:** đầu `handleTelegramUpdate`, nếu `update.my_chat_member` → gọi
   `handleBotPromotedToAdmin`, return `'group'`. Đặt trước branch `message`.
5. **Webhook:** sửa `allowed_updates` ở `set-webhook.ts` + `telegram-dev.ts`.

## Todo
- [ ] Thêm `my_chat_member` vào `TelegramUpdate`
- [ ] Tách `bindAgencyGroupAndEnsureMaster` (DRY với `/link`)
- [ ] `handleBotPromotedToAdmin` + resolve agency qua from.id
- [ ] Nhánh dispatcher cho `my_chat_member`
- [ ] `allowed_updates` += `my_chat_member` (set-webhook + telegram-dev)
- [ ] `npm run typecheck`

## Success criteria
- Add bot vào supergroup forum + cấp admin (can_manage_topics) bởi 1 admin đã link →
  group tự bind đúng agency + 🛠 Master tạo + message xác nhận, KHÔNG cần `/link`.
- Người add chưa link → bot post hướng dẫn, group chưa bind.
- `/link <token>` cũ vẫn hoạt động (fallback).

## Risks
- `my_chat_member` fire nhiều lần (đổi quyền) → guard old/new status + idempotent bind.
- Bot được add nhưng CHƯA cấp can_manage_topics khi event fire → `verifyAgencyGroup` fail →
  trả hướng dẫn; admin cấp xong → event fire lại → bind. Chấp nhận.
