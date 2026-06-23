# Phase 04 — Tests + docs

**Priority:** P2 · **Status:** pending · **Depends:** 03

## Overview
Test nhánh auto-bind + dispatcher rút gọn. Cập nhật docs/README phản ánh flow mới.

## Implementation steps
1. **Unit test** `handleBotPromotedToAdmin`:
   - admin đã link → bind đúng agency + tạo Master (mock verifyAgencyGroup ok).
   - admin chưa link (from.id lạ) → không bind, gửi hướng dẫn.
   - status guard: old=member→new=administrator chạy; member→member bỏ qua; admin→admin idempotent.
2. **Dispatcher test:** message trong group đã bind (bất kỳ thread) → `handleMasterTopicMessage`.
3. **Gỡ/cập nhật** test cũ của `route-group-message` / per-lead routing (đã xóa).
4. **Regression:** `/link <token>` vẫn bind (helper dùng chung).
5. **Docs:** cập nhật `README.md` (mục "Telegram agency group" — bỏ mô tả 2 topic per-lead,
   thêm flow add-bot→admin→auto Master); `docs/system-architecture.md` nếu có mô tả topic.
6. `npm run typecheck && npm run build && <test cmd>` đều pass.

## Todo
- [ ] Test auto-bind (3 case status + chưa-link)
- [ ] Test dispatcher master-only
- [ ] Gỡ test per-lead routing cũ
- [ ] Test regression /link
- [ ] Cập nhật README + system-architecture
- [ ] typecheck + build + test pass

## Success criteria
- Toàn bộ test pass, không test nào bị skip để qua build.
- Docs mô tả đúng flow mới (1 master agent, không per-lead topic).

## Unresolved questions
- Test runner của dự án? (kiểm `package.json` scripts: `test`/`vitest`/`jest`) — xác nhận ở đầu phase.
