---
title: Telegram Auto Master Agent (add bot → admin → auto master)
slug: telegram-auto-master-agent
created: 2026-06-22
status: completed
mode: hard
blockedBy: []
blocks: []
related: [260613-1413-agency-telegram-multitenant, 260613-1752-master-agent-config-topic, 260619-1507-main-assistant-capability-groups]
---

# Telegram Auto Master Agent

## Goal
Agency tạo group Telegram → add bot → cấp quyền admin. Bot **tự động** bind group ↔ agency
và tạo **1 master agent duy nhất** (topic 🛠 Master, chạy `main_assistant` + slash commands).
**Không** còn token `/link` bắt buộc, **không** còn per-lead topics.

## Quyết định (chốt với user)
- **Map agency qua người add bot:** event `my_chat_member` (bot được cấp admin) mang `from.id`
  = người thao tác. `from.id → admins.telegram_user_id → agency_id`. Chưa link → bot nhắc DM
  `/start <token>` rồi cấp lại quyền (hoặc dùng `/link` fallback).
- **Master agent = 1 topic 🛠 Master** (giữ cơ chế hiện có, chỉ đổi trigger từ `/link` sang
  sự kiện bot-được-cấp-admin). Cần Topics bật + `can_manage_topics`.
- **Bỏ per-lead topics hoàn toàn** (Conversation/Assistant per lead). Đã sẵn no-op vì
  `telegram_topics_enabled` mặc định `false` → chủ yếu là gỡ route + caller, không phá data.
- **Notify lead mới / handoff / takeover → đẩy thẳng (proactive) vào master agent** (topic
  🛠 Master) ngay khi xảy ra, KHÔNG cần slash command để thấy. Slash command (`/agent`,
  `/leads`, `/lead_history`…) chỉ dùng để xem chi tiết on-demand & takeover.
- **Giữ `/link <token>` song song** làm fallback khi auto-map thất bại.

## Kiến trúc (1 đoạn)
Thêm nhánh `my_chat_member` vào dispatcher: khi bot chuyển sang `administrator` trong một
supergroup, resolve agency qua `from.id`, verify group (forum + can_manage_topics), gọi lại
đúng logic bind + tạo 🛠 Master đang dùng trong `handleAgencyGroupLink` (tách thành helper
dùng chung `bindAgencyGroupAndEnsureMaster`). Group dispatcher rút gọn: chỉ còn nhánh Master
(và General fallback) — gỡ `routeGroupMessage` per-lead. Notify-agency/handoff trỏ post vào
`telegram_master_topic_id` thay vì topic per-lead. Webhook `allowed_updates` thêm
`my_chat_member`.

## Phases
| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 01 | [Auto-bind qua my_chat_member + webhook allowed_updates](phase-01-auto-bind-my-chat-member.md) | completed | — |
| 02 | [Rút gọn group dispatcher: chỉ Master, gỡ per-lead routing](phase-02-master-only-dispatcher.md) | completed | 01 |
| 03 | [Redirect notify/handoff → Master + gỡ per-lead topic callers](phase-03-notify-and-cleanup.md) | completed | 02 |
| 04 | [Tests + docs](phase-04-tests-docs.md) | completed | 03 |

## Out of scope (YAGNI)
- Per-lead forum topics (bỏ hẳn), mirror lead↔agent đầy đủ.
- Multi-bot / per-agency token (giữ 1 global bot).
- Web UI thay đổi (chỉ đảm bảo `/link` cũ + issue token vẫn chạy).

## Key findings (codebase)
- `handleAgencyGroupLink` (`lib/telegram/handle-lead-telegram-update.ts:74`) đã chứa
  toàn bộ logic bind + tạo 🛠 Master → tách helper tái dùng cho my_chat_member.
- Per-lead topics **đã** no-op: `telegram_topics_enabled` default `false`,
  `bindTelegramGroupToAgency` giữ nó `false` (`lib/db/agency-telegram-links.ts:51`).
- `routeGroupMessage` + `handleConversationTopicMessage`/`handleOperatorTopicMessage`
  chỉ phục vụ per-lead → gỡ.
- `getOrCreateLeadTopics` callers (google-callback, lead-request-link, email, context,
  promote-anonymous, ensure-lead-for-conversation) → gỡ no-op call.
- Webhook `allowed_updates: ['message']` (`scripts/set-webhook.ts:60`) → thêm `my_chat_member`.

## Unresolved questions
- Khi nhiều admin của cùng agency đều link Telegram, người add bot là bất kỳ ai trong số
  đó → OK (đều map về cùng agency). Nếu người add **chưa** link & không ai dùng `/link` →
  group treo chưa bind: chấp nhận, bot hướng dẫn.
