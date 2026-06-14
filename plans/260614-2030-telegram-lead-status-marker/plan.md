---
title: Telegram Lead Status Marker (hot/warm/cold)
slug: telegram-lead-status-marker
created: 2026-06-14
status: completed
mode: fast
blockedBy: []
blocks: []
---

# Telegram Lead Status Marker (hot/warm/cold)

## Goal
Đánh dấu trạng thái tiềm năng (hot/warm/cold) của lead trong Telegram: đổi emoji
đầu tên topic 💬 + post 1 tin thông báo vào topic — **mỗi khi `potential_status` đổi giá trị**.

## Gap hiện tại
`potential_status` được set bởi `record_qualification` + `update_lead_status` (lead-tools.ts)
nhưng **không hề surface lên Telegram**. Topic title cố định `💬 {name} — {listing}`,
admin trong group không biết lead nóng/lạnh.

## Quyết định (chốt với user)
- **Hiển thị:** emoji trong tên topic (🔥/🟡/❄️ đầu title qua `editForumTopic`) + tin thông báo trong topic 1.
- **Trigger:** chỉ push khi `potential_status` **thay đổi giá trị** (so previous), tránh spam.

## Kiến trúc (1 đoạn)
Thêm helper `syncLeadStatusToTelegram(agencyId, leadId, oldStatus, newStatus, reason)` ở
`lib/telegram/lead-status-marker.ts`: nếu old===new → no-op; lookup `getLeadTopicsByLead`;
nếu chưa có topic → no-op; đổi title topic 1 = `{emoji} {displayName} — {listing}` qua
`editForumTopic`; enqueue 1 tin `kind:'critical'` vào topic 1: `🔥 Statut: HOT — {reason}`.
Title cần rebuild đúng (reuse `buildLeadDisplayName` + listing) nên helper tự load lead+listing.
Hook vào `record_qualification` + `update_lead_status` trong lead-tools.ts: so sánh
`lead.potential_status` (trước update) với giá trị mới, gọi helper off response-path (guarded).

## Phases
| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 01 | [Status marker helper + hook vào lead-tools](phase-01-status-marker.md) | completed | — |

## Outcome (shipped)
- `lib/telegram/lead-status-marker.ts` — `syncLeadStatusToTelegram`: chỉ push khi status đổi giá trị;
  đổi emoji (🔥/🟡/❄️) đầu tên topic 💬 qua `editForumTopic` + post tin `kind:'critical'`.
- Hook vào `record_qualification` + `update_lead_status` (capture prev trước updateLead, gọi guarded).
- Review fixes: M1 clamp title ≤128 char + gate notice trên rename thành công; L1 comment tenant guard.
- Tests: 170 unit (5 new title-format) + 263 agent green. typecheck + build clean.

## Out of scope (YAGNI)
- Marker cho lifecycle status (qualified/booked/handoff/abandoned) — chỉ potential hot/warm/cold.
- Marker trên topic 🤖 Assistant (chỉ topic 💬 Conversation).
- Marker cho main_assistant DM / admin operator tự đổi status (chỉ lead-facing tools v1; có thể mở rộng sau).
- Backfill marker cho lead cũ.
