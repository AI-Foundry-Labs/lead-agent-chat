# Phase 02 — Web Admin Auto-Refresh Realtime

## Overview
- **Priority:** High
- **Status:** completed
- **Description:** Khi agent (qua topic Master / DM / tab Assistant) đổi config / listing / handoff rule, web admin tự cập nhật ngay, không cần reload.

## Key Insights
- Web admin (`/admin`) là `force-dynamic` → reload là thấy; nhưng user muốn **realtime**.
- Đã có hạ tầng SSE: `app/api/admin/stream` + `broadcastConversationUpdate` (events.ts) cho chat. Tái dùng pattern này cho "agency-data-changed".
- Config/listing/rule mutations hiện KHÔNG emit gì → web không biết để refetch.

## Related Code Files
**Modify**
- `lib/events.ts` — thêm `broadcastAgencyDataChanged(agencyId, scope?: 'config'|'listings'|'rules')` + cho phép subscribe theo agency.
- `app/api/admin/stream/route.ts` — stream thêm event loại `agency-data` cho admin (scope theo `admin.agency_id`), không chỉ conversation.
- Các tool/mutation emit sự kiện:
  - `lib/agent/tools/main-assistant-tools.ts` — sau `update_criteria`, `update_config`, `create_listing`, `update_listing`, `delete_listing`, `create/toggle/delete_handoff_rule` → gọi `broadcastAgencyDataChanged`.
  - (tùy chọn) emit ngay trong `lib/db/config.ts` / `listings.ts` / `handoff.ts` để DRY — nhưng giữ ở tool layer để tránh DB layer phụ thuộc events. Chọn tool layer.
- Web admin components — lắng nghe SSE event `agency-data` → refetch data (`/api/admin/data`) hoặc `router.refresh()`.
  - `components/admin/admin-shell.tsx` (hoặc nơi fetch data) — mở EventSource tới `/api/admin/stream`, nhận `agency-data` → refetch.

## Implementation Steps
1. `events.ts`: thêm channel agency-scoped + `broadcastAgencyDataChanged(agencyId, scope)`.
2. `stream/route.ts`: với admin đã auth, subscribe agency channel của `admin.agency_id`; đẩy event `{type:'agency-data', scope}`.
3. Tool layer: sau mỗi mutation config/listing/rule → `broadcastAgencyDataChanged(ctx.config.agency_id, scope)`.
4. Web: admin-shell mở EventSource, on `agency-data` → refetch `/api/admin/data` (hoặc `router.refresh()` nếu dùng server component). Debounce nhẹ.
5. typecheck + test.

## Todo List
- [ ] `broadcastAgencyDataChanged` + agency channel trong events.ts
- [ ] stream route đẩy event agency-data (scope theo admin.agency_id)
- [ ] Emit sau các mutation trong main-assistant-tools
- [ ] Web admin-shell nghe SSE → refetch
- [ ] typecheck + test xanh

## Success Criteria
- Đổi criteria/tone/listing/rule qua chat → web admin panel (đang mở) cập nhật trong ~1-2s, không reload thủ công.
- Event scope theo agency → admin agency A không nhận update của agency B.

## Risk
- **Medium:** SSE hiện gắn theo `conversationId`; cần kênh mới theo agency. Mitigation: thêm channel riêng, không phá luồng chat hiện tại.
- **Low:** refetch quá nhiều → debounce.

## Security
- Stream chỉ phục vụ admin đã auth; event scope `admin.agency_id` (không tin client).

## Next
- Độc lập Phase 01/03.
