# Dev Guide — Run, Test & Operate

Hướng dẫn cho **team dev**: chạy local, test, vận hành Telegram, onboard agency. Kiến trúc tổng xem `system-architecture.md`.

---

## 0. Prerequisites
- Node 20+, Docker (Postgres), `.env` (xem `.env.example`).
- Postgres chạy Docker host port **5442** (`DATABASE_URL`).
- LLM key trong `.env` (`AI_GATEWAY_API_KEY` / `LLM_API_KEY`) — cần cho agent.

---

## 1. Setup 1 lần

```bash
docker compose up -d db        # Postgres :5442
npm install
npm run db:migrate             # áp SQL migrations trong ./drizzle (tạo schema)
npm run db:seed                # default agency + 5 criteria + 3 listings + 1 admin
```

**Migration workflow** (đã chuyển khỏi `db:push`):
- Đổi `lib/db/schema.ts` → `npm run db:generate` (tạo file SQL trong `./drizzle`) → `npm run db:migrate`.
- KHÔNG dùng `db:push` nữa (mutate trực tiếp, không reproducible).

**Reset DB sạch** (data chỉ là demo, an toàn local):
```bash
PGPASSWORD=lead_agent_dev psql -h localhost -p 5442 -U lead_agent -d lead_agent_chat \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run db:migrate && npm run db:seed
```

---

## 2. Chạy app

```bash
npm run dev                    # port 3000 mặc định
npm run dev -- -p 3001         # nếu 3000 bận (vd Docker chiếm)
```

> ⚠️ Nếu dùng ngrok/tunnel cho Telegram webhook, app phải chạy ĐÚNG port mà ngrok agent forward tới (vd ngrok → :3001 thì chạy `-p 3001`), nếu không magic link / webhook báo `ERR_NGROK_8012 connection refused`.

**Seed admin:** `admin@gmail.com` / `admin123` (override bằng `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` trước khi seed).

---

## 3. Test luồng LEAD (web, không login)
1. `http://localhost:<port>/` — danh sách bất động sản (đã scope theo agency của Host).
2. Mở listing (`marais-3p`, `montmartre-studio`, `vincennes-maison`) → chat.
3. Hỏi giá/diện tích → AI trả lời; cho budget/timeline → `record_qualification`; "je veux visiter" → đề xuất slot + đặt lịch.
4. **Trigger handoff:** nhắc "négocier le prix" hoặc mở **Vincennes** → conversation chuyển `manual`, AI ngừng auto-reply, agency được noti.

---

## 4. Test luồng ADMIN (web)
1. `http://localhost:<port>/admin/login` → login.
2. Tab **Assistant**: "ajoute un critère quartier préféré" → `update_criteria`.
3. Tab **Conversations**: xem lead, rep trực tiếp, release về agent.

---

## 5. Test MULTI-AGENCY

Onboard agency mới (1 lệnh):
```bash
AGENCY_NAME="Foncia Paris" AGENCY_SLUG="foncia" AGENCY_HOST="foncia.localhost" \
ADMIN_EMAIL="boss@foncia.fr" ADMIN_PASSWORD="foncia123" ADMIN_NAME="Jean Dupont" \
npm run agency:onboard
```
Tạo agency + config + admin đầu tiên, cô lập theo `agency_id`.

**Agency resolution:** `proxy.ts` đọc `Host` header → `agencies.primary_host` → `agency_id` (set vào header `x-agency-id`, server-side, KHÔNG tin client). `localhost` → default agency.

Test routing theo host, thêm vào `/etc/hosts`:
```
127.0.0.1   foncia.localhost
```
rồi `http://foncia.localhost:<port>/`.

**Tenant isolation đã verify:** listing/lead/conversation cô lập theo agency; URL listing của agency A trên host agency B → 404. Header `x-agency-id` client gửi vào bị proxy strip.

---

## 6. Telegram — vận hành

### 6.1. Bot (platform owner, 1 lần)
**Một bot global** cho mọi agency.
- Tạo bot qua **@BotFather** (`/newbot`) → lấy token → set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` trong `.env`.
- **Tắt privacy mode (BẮT BUỘC):** `@BotFather → /setprivacy → <bot> → Disable`. Không tắt thì bot không đọc được tin trong group → routing topic hỏng. Verify: `getMe` trả `can_read_all_group_messages: true`.
- Mỗi token chỉ **1 consumer** tại một thời điểm. Chạy local + production cùng token → **409 Conflict**. Local dev nên dùng **bot riêng**.

### 6.2. Chạy bot local (không cần public URL)
```bash
APP_BASE_URL=http://localhost:<port> npm run telegram:dev   # long-polling
```

### 6.3. Production webhook (cần HTTPS public trong APP_BASE_URL)
```bash
npm run telegram:webhook            # set webhook → APP_BASE_URL/api/telegram
npm run telegram:webhook -- info    # xem trạng thái
npm run telegram:webhook -- delete  # xóa (quay về long-polling)
```
Webhook bảo mật bằng `TELEGRAM_WEBHOOK_SECRET` (Telegram echo header `x-telegram-bot-api-secret-token`, verify timing-safe trong `app/api/telegram/route.ts`).

### 6.4. Link group cho agency (agency admin, 1 lần)

**Option A: Auto-bind (recommended)**
1. Tạo supergroup, bật **Topics**, add bot, phong **Admin** + **Manage Topics**.
2. Bot tự động detect bot được promote → resolve agency qua người promote (nếu đó là admin đã link web) → bind group + tạo topic 🛠 Master.

**Option B: Fallback (/link token)**
1. Nếu người promote chưa link web, dùng: Web `/admin` → "Lier Telegram" → lấy `/link <mã>` → dán vào group.
2. Bot verify token + bind group → tạo topic 🛠 Master.

### 6.5. Topics trong group

| Topic | Phạm vi | Hành vi |
|-------|---------|---------|
| **🛠 Master** | per-agency (1) | Auto-created on bot promotion / `/link` (lưu `agencies.telegram_master_topic_id`). Admin chat here → `main_assistant` agent. Slash commands: `/leads`, `/lead_history`, `/agent`, `/pool`, `/help` (via inline keyboard). Dispatcher routes all group messages here. |

**Hiệu lực mới:**
- Per-lead topics (💬 Conversation, 🤖 Assistant) **bị gỡ** — tất cả tin nhóm route tới Master topic qua `main_assistant`.
- Lead/handoff/alert notifications **push proactive** vào Master topic (thay vì inline reply).
- Outbound qua **per-group send queue** (~20 msg/phút/group): throttle không drop handoff/critical.

### 6.6. Master topic — config qua chat
- Nhắn vào topic 🛠 Master → `handleGroupTelegramMessage` → `runAgentTurn(main_assistant)` với `resolveActingAdmin`.
- Tools `main_assistant`: `update_criteria`, `create_listing`, `update_listing`, `delete_listing`, `bulk_import_listings` (cap 50), handoff rules CRUD, `/leads` (list hot), `/lead_history <lead_id>`, `/agent <lead_id>`, `/pool` (anonymous visitors), `/help`.
- Mỗi mutation → `broadcastAgencyDataChanged(agency_id)` → web admin tự refetch.

### 6.7. Handoff + rep khách
- Handoff rule fire → `conversation.mode='manual'` → AI ngừng → `notifyAgency` push notification vào Master topic (thông báo proactive, không inline).
- Rep khách: Web tab Conversations → `send_reply` → gửi tin tới khách + echo vào Master (icon 🤖 Agent).
- Release: Web tab Conversations → mode='agent'.

### 6.8. Web auto-refresh realtime
- `lib/events.ts`: agency channel + `broadcastAgencyDataChanged(agencyId)`.
- SSE endpoint `app/api/admin/stream-agency` (auth, scope theo `admin.agency_id`).
- `components/admin/admin-shell.tsx` mở EventSource → nhận `agency-data` → refetch `/api/admin/data` (debounce 500ms).
- Chat SSE cũ (`app/api/admin/stream`, keyed conversationId) không đổi.

---

## 7. Test suites

Không cần DB/server:
```bash
npm run typecheck      # 0 errors
npm run test           # unit (pure logic)
npm run test:agent     # agent prompt/tool/rule
```
Cần dev server :3000:
```bash
npm run test:smoke     # HTTP smoke (tự skip nếu không có server)
npm run test:all       # unit + agent, auto-skip smoke
```

---

## 8. Scripts tham chiếu

| Lệnh | Mục đích |
|------|---------|
| `npm run db:migrate` | Áp SQL migrations từ `./drizzle` |
| `npm run db:generate` | Tạo migration sau khi sửa `schema.ts` |
| `npm run db:seed` | Seed default agency + demo |
| `npm run agency:onboard` | Tạo agency + admin mới (env-driven) |
| `npm run telegram:dev` | Bot long-polling (local) |
| `npm run telegram:webhook [info\|delete]` | Quản lý webhook production |
| `npm run dev` | Next.js dev server |

---

## 9. File quan trọng (feature multi-tenant + Telegram)

| File | Vai trò |
|------|---------|
| `lib/db/agencies.ts` | Agency CRUD + lookup theo host/group |
| `lib/agency-context.ts` | `resolveAgencyForVisit` (host-first) |
| `lib/agency-server.ts` | `getRequestAgencyId` (đọc x-agency-id trong server component) |
| `proxy.ts` | Host→agency + admin auth (gộp, Next 16) |
| `lib/db/agency-telegram-links.ts` | Token + bind group↔agency |
| `lib/telegram/bind-agency-group.ts` | Auto-bind supergroup (my_chat_member) + create Master topic |
| `lib/telegram/group-send-queue.ts` | Throttle 20/phút/group + drop policy |
| `lib/telegram/handle-lead-telegram-update.ts` | Webhook router: dispatch group/DM/my_chat_member/callback_query |
| `lib/telegram/handle-group-telegram-message.ts` | Group message dispatcher → Master topic (main_assistant) |
| `lib/telegram/handle-agent-callback.ts` | Inline-keyboard callback (slash commands in Master) |
| `lib/telegram/resolve-agency-admin.ts` | `resolveActingAdmin` (sender → admin, fallback primary) |
| `lib/agent/tools/main-assistant/index.ts` | Master agent tools: config/listing/rules + slash commands |
| `lib/events.ts` | Pub/sub: conversation + **agency** channel |
| `app/api/admin/stream-agency/route.ts` | SSE agency-data → web auto-refresh |
| `scripts/migrate.ts` · `set-webhook.ts` · `onboard-agency.ts` | Ops scripts |

---

## Known limitations
- Send queue in-memory / single-process; multi-instance có thể vượt cap 20/phút/group (cần Redis nếu scale).
- Trần số topic / supergroup chưa verify — ổn ở < 100 lead active/agency.
- Lead-DM Telegram flow cũ (visitor `/start`) vẫn tồn tại song song, chưa gỡ.
- Inbound email → agency dùng best-effort theo domain người nhận, fallback default.

## Unresolved questions
- Domain strategy production: subdomain/agency hay `agency_domains` table cho custom domain?
- Có cần DB unique `(agency_id, email)` trên `leads` để chống race magic-link không?
