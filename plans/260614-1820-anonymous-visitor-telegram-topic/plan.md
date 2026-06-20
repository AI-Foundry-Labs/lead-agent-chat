---
title: Anonymous Visitor → Telegram Topic (ẩn danh, chưa đăng nhập)
slug: anonymous-visitor-telegram-topic
created: 2026-06-14
status: completed
mode: fast
blockedBy: []
blocks: []
---

# Anonymous Visitor → Telegram Topic

## Goal (câu hỏi của user)
Khi **lead chưa đăng nhập** (visitor ẩn danh, chưa có tên/email) chat với hệ thống,
agency vẫn phải **thấy cuộc chat đó trong Telegram** dưới dạng 1 topic riêng cho
visitor ẩn danh — và biết **agent cần config những thông tin gì** để topic này hoạt động.

## Gap hiện tại (đã xác minh trong code)
Visitor ẩn danh hôm nay **KHÔNG có topic Telegram**:
1. `app/api/chat/route.ts:127` tạo `conversation` với `lead_id = null`.
2. `dispatch.ts:87` `mirrorLeadTurnToTopic` **return sớm khi `lead_id` null** → không có gì lên Telegram.
3. Lead + topic chỉ tạo **lazy** qua `ensureLead` (`context.ts:20`) — chỉ chạy khi 1 tool
   (`record_qualification` / `book_viewing`) được gọi. Visitor chỉ hỏi-đáp, không cho budget/email
   → **không có lead, không có topic, agency mù hoàn toàn**.

→ Cần: tạo **lead ẩn danh + topic** sau **tín hiệu tối thiểu**, định danh bằng **số thứ tự per-agency**.

## Quyết định (chốt với user)
- **Trigger:** Tạo topic sau **tín hiệu tối thiểu** — `≥2 tin nhắn lead` trong conversation
  HOẶC agent đã thu được ≥1 mẩu thông tin (giữ nguyên `ensureLead` cho nhánh tool). Giảm spam topic.
- **Định danh:** **Số thứ tự per-agency** — `Visiteur #18 — Marais 2BR`. Counter tăng dần / agency.
- Dùng lại toàn bộ hạ tầng đã có: `lead_telegram_topics`, `getOrCreateLeadTopics`, send-queue, routing.
  KHÔNG tạo bảng topic mới, KHÔNG đổi conversation type.

## "Agent cần config những thông tin gì" (trả lời trực tiếp)
Để 1 visitor ẩn danh hiện ra topic Telegram, agency phải có (đã tồn tại từ multitenant plan):
| Config | Ở đâu | Bắt buộc |
|--------|-------|----------|
| `agencies.telegram_group_chat_id` | set khi `/link <token>` trong supergroup | ✅ |
| `agencies.telegram_topics_enabled = true` | bật topic-per-lead | ✅ |
| Bot là **admin group** + quyền *Manage Topics* | Telegram group settings | ✅ |
| Host→agency resolver (`primary_host`) | để visitor ẩn danh map đúng agency | ✅ (đã có) |
| `agencies.anon_visitor_seq` (MỚI) | counter số thứ tự visitor ẩn danh | ➕ phase này |
→ Nếu agency **chưa link group** hoặc `telegram_topics_enabled=false`: vẫn chạy web bình thường,
  chỉ không tạo topic (`getOrCreateLeadTopics` đã trả null an toàn).

## Phases
| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 01 | [Anon lead seq + tạo topic sau tín hiệu tối thiểu](phase-01-anon-lead-and-trigger.md) | completed | — |
| 02 | [Số thứ tự trong title + seed message ngữ cảnh + mirror lịch sử](phase-02-title-and-seed.md) | completed | 01 |

## Outcome (shipped)
- `agencies.anon_seq_counter` + `leads.anon_seq` (columns applied via psql; `db:push` is interactive on non-empty DB).
- `incrementAnonSeq` (atomic), `attachLeadIfAnonymous` (conditional attach — closes promote race), `deleteLead` (orphan cleanup).
- `promoteAnonymousVisitor` (race-safe: create → conditional-attach → win? provision topics : delete orphan). Off response-path, guarded.
- Trigger in `app/api/chat/route.ts`: still-anonymous + ≥2 user messages → promote (passes detected lang + preloaded messages).
- Title `Visiteur #N` via `buildLeadDisplayName(name, email, anonSeq?)`.
- Seed context header (`📋 Visiteur #N • Annonce • Langue • Début`) + one-time backfill of prior turns into Topic 1.
- Tests: 160 unit (6 new anonSeq), 263 agent — all green. typecheck + build clean.
- Code review: H1 race + M1/L1/L2 all addressed.

## Kiến trúc (1 đoạn)
Thêm `agencies.anon_seq_counter` (int, default 0). Trong `app/api/chat/route.ts` sau khi
`runAgentTurn` chạy: nếu `conversation.lead_id` vẫn null VÀ đã đạt ngưỡng (đếm message lead ≥2),
gọi `promoteAnonymousVisitor(conv, agencyId)` — tạo lead ẩn danh (atomically cấp số thứ tự bằng
`UPDATE agencies SET anon_seq_counter = anon_seq_counter + 1 RETURNING`), attach vào conversation,
lưu số thứ tự, rồi `getOrCreateLeadTopics`. Title builder dùng số thứ tự thay cho "Visiteur" trơn.
Sau khi topic tạo xong, mirror **lịch sử** message đã có (2 tin trước đó) vào Topic 1 để agency không
mất ngữ cảnh. Toàn bộ off response-path, guarded, không bao giờ throw vào web turn.

## Out of scope (YAGNI)
- Realtime topic ngay tin nhắn đầu (user chọn "sau tín hiệu tối thiểu").
- Auto-archive topic visitor thoát ngay.
- Anti-spam nâng cao (rate-limit theo IP/fingerprint) — chỉ dùng ngưỡng message count.
- Đổi nhánh `ensureLead` (qualify/booking) — giữ nguyên, chỉ thêm nhánh "tín hiệu hội thoại".
