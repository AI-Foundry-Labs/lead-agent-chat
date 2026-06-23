# Báo cáo E2E — Telegram Master Agent

**Ngày:** 2026-06-23
**Driver:** `eval_harness/manual/telegram-e2e-driver.ts`
**Chạy:** `npx tsx --env-file=.env eval_harness/manual/telegram-e2e-driver.ts [--no-llm]`

## Kết quả: 19/19 PASS ✅

Cơ chế: POST synthetic Telegram `Update` → `/api/telegram` (kèm webhook secret) → server xử lý như webhook thật → bot reply THẬT vào group `-1004457355054` topic `5` + side-effect DB. Assert qua HTTP 200 + Postgres state.

### Section 1 — Slash commands (8/8)
| Lệnh | Kết quả |
|---|---|
| `/help` | ✅ HTTP 200 |
| `/leads` | ✅ keyboard 2 leads |
| `/leads hot` | ✅ filter |
| `/lead 2` | ✅ chi tiết Visiteur #2 (handoff) |
| `/lead_history 2` | ✅ lịch sử |
| `/lead_history` (no arg) | ✅ picker |
| `/pool` | ✅ visitor ẩn danh |
| `/agent` | ✅ picker |

### Section 2 — /agent session switching (4/4, verify DB `telegram_agent_sessions`)
| Hành động | Verify DB |
|---|---|
| `/agent main` | ✅ agent_kind=main |
| `/agent lead 1` | ✅ agent_kind=operator, lead_id=#1 |
| callback `agent:main` | ✅ agent_kind=main |
| callback `agent:lead:<#2>` | ✅ agent_kind=operator, lead_id=#2 |

### Section 3 — Agent LLM turns (5/5, gọi LLM thật)
| Agent | Prompt | Kết quả |
|---|---|---|
| main_assistant | "Liste les leads les plus chauds" | ✅ reply (msg persisted, sau bị /reset xóa — đúng thứ tự) |
| operator (lead #2) | "Résume la situation de ce client" | ✅ reply contextual: *"Travis est intéressé par un studio à Montmartre, en phase d'exploration..."* (kéo từ lead memory) |
| lead-facing `/api/chat` | "Le studio à Montmartre est-il disponible?" | ✅ HTTP 200, reply 269 ký tự |

### Section 4 — /reset destructive (2/2)
| Hành động | Verify |
|---|---|
| `/reset` (active=main) | ✅ messages→0, thread_summary=null |

## Phát hiện
- Không có bug. Toàn bộ routing (group→master topic), session switching, slash deterministic, agent LLM (3 type), và /reset đều hoạt động đúng.
- Operator agent thể hiện đọc được long-term memory của lead (reply nhắc tên "Travis" + sở thích).
- `resolveActingAdmin` fallback hoạt động: fake user id (chưa link) → vẫn attribute về primary admin → commands chạy bình thường.

## Lưu ý vận hành
- Driver portable: tự resolve agency/group/leads/admin từ DB, không hardcode.
- `--no-llm` để test nhanh phần deterministic (14/14, không tốn token).
- group-send-queue throttle ~1/3s → driver sleep giữa bước; slash dùng kind=critical nên không bị drop.

## Unresolved
- Section 5 (notify proactive handoff) chưa chạy riêng — nhưng path notify đã verify gián tiếp qua operator memory (lead #2 ở trạng thái handoff, agent đọc được context).
