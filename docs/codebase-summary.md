# Codebase Summary

## Directory Structure

```
lib/
├── db/                          # Database schema + query helpers
│   ├── schema.ts                # Drizzle schema (conversations, messages, leads, agencies, etc.)
│   ├── agencies.ts              # Agency CRUD + listing scoped queries
│   ├── agency-telegram-links.ts # Telegram group binding + token management
│   ├── lead-telegram-topics.ts  # Per-lead topic mapping (conversation + assistant)
│   ├── conversations.ts         # Conversation CRUD + mode/type checks
│   ├── messages.ts              # Message insert + fetch
│   ├── leads.ts                 # Lead CRUD + qualification state
│   ├── handoff.ts               # Handoff rules + helpers
│   └── [other domains]          # Calendar, email, listings, etc.
│
├── agent/
│   ├── run.ts                   # runAgentTurn — stateless-per-turn loop (tool-calling, dispatch hooks)
│   ├── tools/
│   │   ├── main-assistant/
│   │   │   ├── index.ts         # Barrel: merges all capability group tools
│   │   │   ├── leads.ts         # Lead CRUD tools
│   │   │   ├── listings.ts      # Listing query tools
│   │   │   ├── messaging.ts     # search_messages (extended w/ channel filter)
│   │   │   ├── viewings.ts      # Viewing slot tools
│   │   │   ├── config.ts        # Agency config tools
│   │   │   ├── telegram.ts      # Telegram-specific tools
│   │   │   ├── analytics.ts     # Agency analytics
│   │   │   ├── subagents.ts     # Subagent dispatch tools
│   │   │   ├── templates.ts     # F4b: message template CRUD + render
│   │   │   ├── visitor-pool.ts  # F1: anonymous visitor pool tools
│   │   │   ├── gdpr.ts          # F4d: consent + audit + erasure tools
│   │   │   └── scheduled-messages.ts  # F4a: schedule/list/cancel tools
│   │   ├── lead-tools.ts        # record_qualification, book_viewing, etc. (Zod-validated)
│   │   └── admin-tools.ts       # update_criteria, send_reply, etc.
│   ├── templates/               # F4b: template rendering engine
│   │   └── render-template.ts   # Pure placeholder substitution ({{name}}, {{email}}, etc.)
│   └── prompts.ts               # buildLeadSystemPrompt, buildAdminSystemPrompt
│
├── telegram/
│   ├── bind-agency-group.ts     # Auto-bind group on bot promotion + create Master topic (my_chat_member)
│   ├── group-send-queue.ts      # Per-group throttle queue + drop policy (20 msg/min)
│   ├── handle-lead-telegram-update.ts  # Webhook router: group/DM + my_chat_member + callback_query
│   ├── handle-private-telegram-message.ts  # Extracted DM dispatch logic
│   ├── handle-group-telegram-message.ts  # Group message routing (Master topic check → main_assistant)
│   ├── handle-agent-callback.ts # Inline-keyboard callback_query handler (Master topic commands)
│   ├── notify-agency.ts         # Push handoff/alert notifications to Master topic
│   ├── verify-agency-group.ts   # Check update.chat.id ∈ registered groups
│   ├── resolve-agency-admin.ts  # Telegram sender → admin lookup (with rejection on unmapped)
│   └── [other helpers]          # Agent command parsing, topic creation, etc.
│
├── scheduling/
│   ├── deliver-due-scheduled-messages.ts  # F4a: claim-and-deliver loop (FOR UPDATE SKIP LOCKED)
│   ├── scheduled-message-loop.ts          # Polling interval driver
│   └── paris-time.ts                      # Europe/Paris ↔ UTC conversion (Intl-based)
│
├── agency-context.ts            # Host/subdomain → agency resolver (middleware data)
├── telegram.ts                  # Low-level Telegram API wrapper (sendTelegramMessage, etc.)
├── dispatch.ts                  # Mirror dispatch hooks for agent replies (mirrorLeadTurnToTopic)
├── instrumentation.ts           # Scheduler registration hook (gated by RUN_SCHEDULER env)
├── [other modules]              # calendar.ts, email.ts, events.ts, notify.ts, etc.
│
app/
├── api/
│   ├── chat/                    # Lead inbound (POST) + SSE stream
│   ├── admin/
│   │   ├── data/route.ts        # GET leads, conversations (agency-scoped)
│   │   ├── operator/chat/route.ts  # Admin operator conversation (with C2 IDOR guard)
│   │   ├── actions/route.ts     # Takeover, release, send_reply (with C3 IDOR guard)
│   │   ├── link-telegram/route.ts  # Issue Telegram link token
│   │   ├── stream/route.ts      # SSE stream for admin (with C4 IDOR guard)
│   │   └── [other routes]
│   ├── telegram/route.ts        # Webhook endpoint (secret-verified, dispatch to group/DM handlers)
│   ├── email/route.ts           # Future email inbound
│   └── [other routes]
│
├── listings/                    # Web UI for lead: browse + open property chat
├── chat/                        # Lead chat UI (SSE + agent reply streaming)
├── admin/                       # Admin panel: assistant, Telegram link, operator chat, conversation view
└── [layout, middleware]

scripts/
├── migrate-add-agency.ts        # Migration: add agencies table + backfill existing data

middleware.ts                    # Host/subdomain → agency (x-agency-id header, stripped for security)

env.example                      # Set TELEGRAM_WEBHOOK_SECRET, DATABASE_URL, etc.
```

## New Multi-Tenant Files (June 13, 2026)

| File | Purpose |
|------|---------|
| `lib/db/agencies.ts` | Agency table queries, listing/rule scoping by agency. Includes `incrementAnonSeq`. |
| `lib/agency-context.ts` | Host header → agency resolver; handles IPv6 dev hosts. |
| `lib/db/agency-telegram-links.ts` | Token generation, group binding (`telegram_group_chat_id`). |
| `lib/telegram/bind-agency-group.ts` | Auto-bind supergroup on bot promotion (my_chat_member), create 🛠 Master topic. Shared logic for /link fallback. |
| `lib/telegram/bind-agency-group.ts` | Auto-bind supergroup to agency on bot promotion + create Master topic. |
| `lib/telegram/group-send-queue.ts` | Per-group throttle queue (3s drain, ~20 msg/min). |
| `lib/telegram/handle-lead-telegram-update.ts` | Webhook router: dispatch to group/DM handlers; check my_chat_member + callback_query. |
| `lib/telegram/handle-group-telegram-message.ts` | Group message dispatcher: Master topic → main_assistant; other routes → handoff. |
| `lib/telegram/handle-agent-callback.ts` | Inline-keyboard callback_query handler for Master topic slash commands. |
| `lib/telegram/notify-agency.ts` | Push handoff/alert notifications proactively to Master topic. |
| `lib/telegram/verify-agency-group.ts` | Check update is from a registered agency group. |
| `lib/telegram/resolve-agency-admin.ts` | Sender (telegram_user_id) → admin lookup. |
| `lib/telegram/promote-anonymous-visitor.ts` | Promote anonymous leads: increment counter, attach lead, backfill Telegram topic. |
| `scripts/migrate-add-agency.ts` | Migration: add `agencies` table + `agency_id` FK + backfill. |
| `middleware.ts` (modified) | Set `x-agency-id` header (server-resolved, client-supplied stripped). |

## New Capability Group Files (June 20, 2026: F1, F4a–d)

| File | Capability | Purpose |
|------|-----------|---------|
| `lib/db/message-templates.ts` | F4b | Create/update/delete reusable message templates per agency. |
| `lib/db/consents.ts` | F4d | Record/retrieve consent state (GDPR basis tracking). |
| `lib/db/audit-helpers.ts` | F4d | `recordAudit` (call-site helper, best-effort, non-blocking). |
| `lib/db/audit-log.ts` | F4d | Query audit history for lead (Art. 15). |
| `lib/db/scheduled-messages.ts` | F4a | Schedule/list/cancel message delivery (with retry state). |
| `lib/agent/tools/main-assistant/templates.ts` | F4b | List/get/create/update/delete/render message templates. |
| `lib/agent/tools/main-assistant/visitor-pool.ts` | F1 | List/read/identify anonymous visitors. Reuses `promoteAnonymousVisitor`. |
| `lib/agent/tools/main-assistant/gdpr.ts` | F4d | set_consent, view_consent_status, view_audit_history, export_lead_data (Art. 15). |
| `lib/agent/tools/main-assistant/scheduled-messages.ts` | F4a | schedule_message, list_scheduled_messages, cancel_scheduled_message (Paris timezone). |
| `lib/agent/templates/render-template.ts` | F4b | Pure placeholder renderer: `{{name}}`, `{{email}}`, `{{listing_title}}`, `{{agency_name}}`. |
| `lib/scheduling/deliver-due-scheduled-messages.ts` | F4a | Claim-and-deliver loop (FOR UPDATE SKIP LOCKED, at-least-once, retry ≤3). |
| `lib/scheduling/scheduled-message-loop.ts` | F4a | Polling interval driver (~30s). |
| `lib/scheduling/paris-time.ts` | F4a | Europe/Paris ↔ UTC conversion (Intl-based, no new dependencies). |

## Core Tables (Schema)

```
agencies
  id UUID PK
  name TEXT
  telegram_group_chat_id BIGINT (nullable, until /link or bot promotion)
  telegram_master_topic_id INT (nullable, until Master topic created)
  config_json JSONB (criteria, etc.)
  anon_seq_counter INT (default 0) ← Per-agency counter for anonymous visitor sequencing

conversations
  id UUID PK
  agency_id UUID FK → agencies
  lead_id UUID FK → leads (nullable for admin conv)
  type ENUM ('lead', 'operator') ← was 'conversation' + 'operator'
  mode ENUM ('agent', 'manual') ← 'agent' = auto-reply, 'manual' = takeover
  messages TEXT[] (OpenAI compatible)

leads
  id UUID PK
  agency_id UUID FK → agencies (NEW)
  listing_id UUID FK → listings
  email TEXT
  anon_seq INT (nullable) ← Sequence number for anonymous-promoted leads

listings
  id UUID PK
  agency_id UUID FK → agencies (NEW)
  [property details]

admins
  id UUID PK
  agency_id UUID FK → agencies (NEW)
  [name, email, telegram_user_id, etc.]

[Per-lead topics REMOVED — all group messages route to Master topic via main_assistant]

handoff_rules, agency_config, viewing_slots
  [all have agency_id FK]

message_templates (F4b)
  id UUID PK
  agency_id UUID FK → agencies
  name TEXT
  content TEXT (with {{}} placeholders)
  created_at TIMESTAMP

lead_consents (F4d)
  id UUID PK
  lead_id UUID FK → leads (CASCADE on delete)
  agency_id UUID FK → agencies
  basis TEXT (legal basis for processing)
  granted_at TIMESTAMP

audit_log (F4d)
  id UUID PK
  target_lead_id UUID (NO FK — survives lead erasure)
  agency_id UUID FK → agencies
  action TEXT (lead_viewed, lead_updated, message_sent, lead_erasure_executed, etc.)
  recorded_at TIMESTAMP
  metadata JSONB (optional context)

scheduled_messages (F4a)
  id UUID PK
  conversation_id UUID FK → conversations
  agency_id UUID FK → agencies
  content TEXT
  send_at TIMESTAMP (Europe/Paris)
  status ENUM ('pending', 'sent', 'failed')
  attempt_count INT (0–3)
  created_at TIMESTAMP
  sent_at TIMESTAMP (nullable)
```

## Authorization Boundaries

- **Request → agency:** Resolved in `middleware.ts` via Host/subdomain (primary), listing consistency check (secondary), default fallback (dev only).
- **Admin routes:** All `app/api/admin/*` routes check `resource.agency_id === admin.agency_id` before returning data or mutating.
- **Client headers:** `x-agency-id` is unconditionally stripped by middleware; server-resolved value is the only source.
- **Telegram group:** Webhook rejects updates from unregistered `chat.id`.
- **Telegram sender:** Operator turns require sender (telegram_user_id) → admin lookup; unmapped senders rejected.

## Key Behaviors

### Telegram: Agency Control Surface

- **Per-agency group:** Each agency links ONE supergroup (forum) via `/link <token>` in the general chat.
- **Per-lead topics:** Two auto-created forum topics per lead:
  - Topic 1 (💬 Conversation): Lead inbound + final agent reply (mirrored, throttled ~20 msg/min).
  - Topic 2 (🤖 Assistant): Operator/copilot replies (internal, never mirrored).
- **Message routing:** By `message_thread_id` + sender admin check.
- **Handoff notification:** Handoff events sent to Topic 1 + General.
- **Takeover source:** Both web and Telegram (Topic 1 admin reply) set `conversations.mode = 'manual'`.

### Agent Loop

1. Load conversation + context (Postgres, scoped by agency).
2. Build system prompt (agency config, user persona, tools).
3. Call model with tool-calling (max 6 steps).
4. Persist message + state.
5. Dispatch:
   - Web lead: SSE stream.
   - Web admin: JSON response.
   - Telegram lead: Enqueue to group send queue (throttled, mirror may drop).
   - Telegram operator: Direct group send to Topic 2 (never drop).

### Send Queue & Throttle

- Per-group in-memory queue, 3s drain interval (~20 msg/min, Telegram API cap).
- On 429: exponential backoff, retry up to 5× with `retry_after` respect.
- **Drop policy:** `kind: 'mirror'` (lead inbound + final reply) drop oldest-first if queue > 50 items.
- **Never drop:** Handoff, takeover, operator replies.

## Version History

- **2026-06-13:** Multi-tenant GA. Agencies table + agency_id FK across core tables. Telegram shifted from per-admin DM sync to per-agency group + per-lead topic model. 4 critical IDOR fixes (C1–C3, C4 stream). 2 important fixes (I1 guard sweep, I2 IPv6).
