---
title: Master Agent Config Topic (Telegram) + Web Auto-Refresh + Bulk Import
slug: master-agent-config-topic
created: 2026-06-13
status: completed
mode: fast
blockedBy: []
blocks: []
---

# Master Agent Config Topic + Web Auto-Refresh + Bulk Import

## Goal
Cho admin cấu hình agency (đổi criteria/tone, thêm/sửa/xóa & import listing, quản lý handoff rules) **chỉ bằng cách nhắn vào 1 topic "🛠 Master" riêng trong group Telegram của agency**. Thay đổi áp dụng ngay vào DB và **web admin tự refresh realtime**.

## Bối cảnh (đã tồn tại — KHÔNG build lại)
Master agent = conversation type `main_assistant` (đã có), chạy ở tab Assistant (web) + admin DM (Telegram). Tools đã có:
- `update_criteria`, `update_config` (name/tone)
- `create_listing`, `update_listing`, `list_listings`
- `create_handoff_rule`, `toggle_handoff_rule`, `delete_handoff_rule`, `list_handoff_rules`
- leads/viewings/reports tools

→ Chỉ cần: (1) 1 topic Master trong group → route vào main_assistant; (2) web auto-refresh; (3) `delete_listing` + bulk import.

## Quyết định (chốt với user)
- **Dùng `main_assistant` sẵn có** (không tạo agent mới).
- **Thêm 1 topic "🛠 Master" / agency** trong group (per-agency, KHÁC topic per-lead).
- **Web auto-refresh realtime** khi config/listing/rule đổi.
- **Bulk import listing** (paste danh sách / CSV-like).

## Phases
| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 01 | [Master topic trên Telegram → main_assistant](phase-01-master-topic-routing.md) | pending | — |
| 02 | [Web admin auto-refresh realtime](phase-02-web-auto-refresh.md) | pending | — |
| 03 | [delete_listing + bulk import listing](phase-03-delete-and-bulk-import.md) | pending | — |

## Kiến trúc (1 đoạn)
`agencies.telegram_master_topic_id` lưu thread id của topic 🛠 Master (tạo khi `/link` hoặc lần đầu). Group dispatcher thêm nhánh: `message_thread_id === master_topic_id` → `runAgentTurn(mainAssistantConv, text, {type:'main_assistant'})`, reply post lại vào topic Master. Khi tool config/listing/rule chạy → emit một sự kiện "agency-data-changed" → web admin (SSE) refetch. Bulk import = 1 tool mới parse danh sách → tạo nhiều listing (validate từng cái, báo cáo ok/lỗi).

## Out of scope (YAGNI)
- Import từ file upload thực sự / URL crawl (chỉ paste text trong chat).
- Phân quyền config riêng (mọi admin của agency đều dùng được).
- Undo/history config.
