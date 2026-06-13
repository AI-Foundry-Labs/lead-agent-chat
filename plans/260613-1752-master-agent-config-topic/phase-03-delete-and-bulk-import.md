# Phase 03 — delete_listing + Bulk Import Listing

## Overview
- **Priority:** Medium
- **Status:** completed
- **Description:** Thêm tool `delete_listing` và `bulk_import_listings` cho master agent — admin paste danh sách BĐS trong chat → tạo nhiều listing 1 lần.

## Key Insights
- `create_listing` / `update_listing` đã có (single). Thiếu `delete_listing` và import hàng loạt.
- `deleteListing(id)` đã có ở `lib/db/listings.ts` — chỉ cần expose qua tool + agency-scope guard.
- Bulk import: LLM tự parse text tự do thành mảng listing rồi gọi tool với mảng đã cấu trúc (Zod validate). Không cần parser riêng phức tạp — agent đọc text, tool nhận array.

## Related Code Files
**Modify**
- `lib/db/listings.ts` — `deleteListing` đã có; thêm `createListingsBulk(agencyId, items[])` (insert nhiều, trả ok/lỗi từng cái) hoặc loop `createListing` trong tool.
- `lib/agent/tools/main-assistant-tools.ts`:
  - `delete_listing` tool: input `{ id }`; guard `getListing(id).agency_id === ctx.config.agency_id` trước khi xóa (tenant safety); emit agency-data-changed (Phase 02).
  - `bulk_import_listings` tool: input `{ listings: z.array(listingInputSchema).min(1).max(50) }`; tạo từng cái với `agency_id = ctx.config.agency_id`, validate, trả `{created:[], failed:[{index,reason}]}`; emit agency-data-changed.

## Implementation Steps
1. `delete_listing` tool + tenant guard + emit event.
2. Định nghĩa `listingInputSchema` (title, address, price, surface_m2, rooms, floor, description, key_features[], + bản _en hoặc auto-fallback) — tái dùng từ `create_listing` nếu có.
3. `bulk_import_listings` tool: loop tạo, gom kết quả ok/fail (không fail-all nếu 1 cái lỗi), cap 50/lần.
4. Cập nhật prompt main-assistant: liệt kê `delete_listing`, `bulk_import_listings` + hướng dẫn "khi admin paste nhiều BĐS → gọi bulk_import_listings".
5. typecheck + test.

## Todo List
- [ ] `delete_listing` tool + tenant guard
- [ ] `listingInputSchema` tái dùng
- [ ] `bulk_import_listings` (cap 50, báo ok/fail từng item)
- [ ] Cập nhật prompt
- [ ] Emit agency-data-changed (nối Phase 02)
- [ ] typecheck + test xanh

## Success Criteria
- "Xóa listing vincennes-maison" → agent xóa (chỉ trong agency mình).
- Paste 5 BĐS → agent tạo cả 5, báo cáo cái nào lỗi (thiếu giá…), web refresh.
- Không tạo/xóa được listing của agency khác.

## Risk
- **Medium:** import data bẩn → 1 item lỗi không được làm hỏng cả batch. Mitigation: try/catch từng item, trả failed list.
- **Low:** listing id do user đặt trùng → create báo lỗi, không ghi đè.

## Security
- Mọi create/delete scope `ctx.config.agency_id`; delete guard ownership trước khi xóa.

## Next
- Hoàn tất feature; cập nhật docs dev-guide + agency-user-guide (master topic + bulk import).
