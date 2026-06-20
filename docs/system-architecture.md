# System Architecture

## Overview

Lead-agent-chat is a multi-tenant, agentic conversation platform for real-estate lead qualification. One global Telegram bot serves N agencies; each agency hosts its own supergroup (forum) and connects web visitors via subdomains. All state is persisted in Postgres and keyed by `conversation` (lead↔agent or lead↔copilot). No durable workflows — each message triggers `runAgentTurn`, which loads context, runs the model with tool-calling, and dispatches the reply.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Lead / Admin                          │
│  (Web visitor subdomain, e.g. foncia.app.com / Telegram DM) │
└──────────────┬──────────────────────────────────────────────┘
               │
       ┌───────▼────────┐
       │ Agency Router  │  (middleware.ts: Host/subdomain → agency)
       │  (multi-tenant)│
       └───────┬────────┘
               │
       ┌───────▼─────────────────────────────────────────┐
       │         Conversation Context Loader             │
       │  (Postgres: conversation + messages + state)    │
       └───────┬─────────────────────────────────────────┘
               │
       ┌───────▼────────────────────────┐
       │  runAgentTurn (lib/agent/run.ts)│  
       │  • Tool-calling loop (max 6)   │
       │  • Dispatch hooks (Telegram)   │
       └───────┬──────────────────────┬──┘
               │                      │
       ┌───────▼──────┐   ┌──────────▼────────────────┐
       │   Postgres   │   │ Dispatch & Integrations  │
       │ (Persist     │   │ • Email, Calendar        │
       │  context &   │   │ • Telegram (per-channel) │
       │  messages)   │   │ • Webhook auth           │
       └──────────────┘   └─────────────────────────┘
```

## Multi-Tenant Scoping

### Agency Assignment (Request → Tenant)

Request → agency is resolved in **`middleware.ts`** with a **host-first** strategy:

1. **Host/subdomain** (primary): Matches request `Host` header against `domain_mapping.agency_id`. Example: `foncia.app.com` → agency `A`.
2. **Listing consistency check** (if lead submits a listing): Must have `listing.agency_id = resolved_agency_id`.
3. **Default fallback** (dev/localhost only): Points to a default agency.

The resolved `agency_id` is stored in request headers (`x-agency-id`) **server-side only**. Client headers are **stripped** before processing (C1 security fix).

### Core Tables with `agency_id` FK

```
agencies (id, name, telegram_group_chat_id, config_json)
  ├── admins (id, agency_id, ...)
  ├── leads (id, agency_id, ...)
  ├── conversations (id, agency_id, type, mode, ...)
  ├── listings (id, agency_id, ...)
  ├── handoff_rules (id, agency_id, ...)
  ├── agency_config (id, agency_id, ...)
  ├── viewing_slots (id, agency_id, ...)
  └── lead_telegram_topics (lead_id, conversation_id, agency_id, group_chat_id, conversation_topic_id, assistant_topic_id)
```

Every query is scoped by `agency_id` in the WHERE clause. Mutation routes check `resource.agency_id === admin.agency_id` before proceeding (IDOR guards).

## Telegram: Agency Control Surface

One global bot (single token/webhook) is group admin of each agency's supergroup.

### Group Setup

- **Agency → Group binding:** `/link <token>` in the group's general chat invokes `handleAgencyGroupLink`, which stores `agency.telegram_group_chat_id = chat.id`.
- **Idempotent by token:** Each token is single-use, short-lived; replay is rejected.

### Per-Lead Topic Model

When a lead contacts the web form, two forum topics are auto-created in the agency's group:

| Topic | Purpose | Access | Messages |
|-------|---------|--------|----------|
| **💬 Conversation (Topic 1)** | Live lead↔agent mirror | Agency admins | Lead inbound + final agent reply (1 msg/turn) + handoff/takeover events |
| **🤖 Assistant (Topic 2)** | Per-lead copilot (`operator` conv) | Agency only | Admin prompts; copilot replies (internal, not sent to lead) |

Both topics are stored in `lead_telegram_topics` (indexed by `lead_id`, keyed by `agency_id`).

### Message Routing (Inbound Group → Handler)

| Condition | Route | Handler |
|-----------|-------|---------|
| Private DM, `/start <token>` | Admin/lead linking | Existing flow (unchanged) |
| Group, `/link <token>` | Bind group → agency | `handleAgencyGroupLink` |
| Group, `chat.id ∉ agencies.telegram_group_chat_id` | Unregistered group | **Ignored** |
| Group, `from.is_bot === true` | Bot echo | **Ignored** (echo-loop prevention) |
| Group, duplicate `update_id` | Idempotency dedup | **Ignored** |
| Group, `message_thread_id === conversation_topic_id` | Topic 1 (lead takeover) | `handleLeadTakeoverMessage` (phase 05) |
| Group, `message_thread_id === assistant_topic_id` | Topic 2 (operator copilot) | `handleOperatorTopicMessage` |
| Group, general / no thread | — | **Ignored** |

### Outbound Dispatch (Agent → Telegram)

**Mirror policy:** After `runAgentTurn`, if `conversation.type === 'lead'`:
- `mirrorLeadTurnToTopic` enqueues lead inbound message (if new) + final reply into the group's Topic 1 via `enqueueGroupSend`.
- For `conversation.type === 'operator'`: Copilot replies are **never mirrored** to the group (internal only).

**Throttle & Drop Policy:**

- **Per-group send queue** (`lib/telegram/group-send-queue.ts`) drains every ~3s (~20 msg/min, Telegram API cap).
- On **429 rate-limit**: back off with exponential retry (up to 5 attempts), respecting `retry_after` header.
- **Drop policy:** `kind: 'mirror'` messages (lead inbound + final reply) may be dropped oldest-first if queue > 50 items. **Critical messages** (handoff, takeover, operator replies) are **never dropped**.
- **In-memory only:** Each app instance has its own queue. Multi-instance deployments note: upgrade to Redis-backed queue if scaling beyond ~1 replica.

### Takeover & Mode (Source of Truth: `conversations.mode`)

- **Takeover trigger:** An admin replies in Topic 1 → sets `conversations.mode = 'manual'`.
- **Takeover source:** Both web (POST `/api/admin/actions`) and Telegram (Topic 1 message) set the mode.
- **Resume:** `/resume` in the admin panel or Telegram returns control to the agent (`mode = 'agent'`).
- **During takeover:** Lead messages are **logged** but the agent **does not auto-reply**. Admin replies are **relayed to the lead** (as if agent is typing).

### Handoff Notification

When `conversations.mode` changes to `manual` (handoff occurs):
1. Create a handoff event in the agency group (Topic 1 + General).
2. Notify all agency admins (via Telegram group notification, or web dashboard ping).
3. Operator conversation auto-closes if it was active.

## Security Boundaries

### Authorization Layer

- **Admin routes** (`app/api/admin/*`): All load a resource (lead, conversation, listing, etc.) by client-supplied ID. Ownership checks are **mandatory:**
  - `lead.agency_id !== admin.agency_id` → 404 not_found.
  - `conversation.agency_id !== admin.agency_id` → 404 not_found.
  - Listing/rule mutations: fetch by ID, check `agency_id` before mutating.
- **Client-supplied headers:** `x-agency-id` is **unconditionally stripped** and server-resolved only.

### Telegram Webhook Security

- Webhook auth: Verified against `TELEGRAM_WEBHOOK_SECRET` (X-Telegram-Bot-Api-Secret-Token header).
- Group membership: Webhook only processes updates from `chat.id ∈ agencies.telegram_group_chat_id`.
- Admin resolver: Operator turns require `sender_telegram_id → admin` lookup; unmapped senders are rejected with a hint, not silently ignored.

## Agent Loop (Stateless Per Turn)

**Entry points:**
- Web: POST `/api/chat` (lead message) or `/api/admin/chat` (admin message).
- Telegram: Webhook /api/telegram routes to `runAgentTurn`.
- Email: `/api/email` (future; not yet integrated).

**Flow:**

```
1. Load conversation + context (Postgres)
2. Build system prompt (agency config, lead tools, admin tools)
3. Call model with tool-calling
4. Tool loop (max 6 steps):
   - Execute tool → DB mutation or integration call
   - Model processes result → decides next action
5. Persist final message + state
6. Dispatch reply:
   - If lead conv + web: return SSE stream
   - If admin conv + web: record in DB, return JSON
   - If lead conv + Telegram: enqueue to group send queue (throttled)
   - If operator conv + Telegram: send to Topic 2 only
7. Done (stateless; next message starts fresh)
```

**Tool set:**
- **Lead tools:** `record_qualification`, `get_available_slots`, `book_viewing`, `call_admin`.
- **Admin tools:** `get_conversation`, `send_reply`, `update_criteria`, `get_available_slots`.

## Data Flow: Web → Conversation → Telegram

```
┌─────────────────────────────────────┐
│ Lead opens web chat (foncia.app.com)│
│ Host → agency A (middleware)        │
└──────────────┬──────────────────────┘
               │
       ┌───────▼─────────────┐
       │ GET /api/listings   │  (agency-scoped)
       │ POST /api/chat      │  (lead message)
       └───────┬─────────────┘
               │
       ┌───────▼──────────────────────────┐
       │ runAgentTurn (leadConversation)  │
       │ • Load lead context              │
       │ • Run model + tools              │
       │ • Record message + state         │
       └───────┬──────────────────────────┘
               │
       ┌───────▼──────────────────────────────────┐
       │ Dispatch reply                           │
       │ • SSE stream to web                      │
       │ • enqueueGroupSend (Topic 1, throttled)  │
       │ • Email notification (if handoff)        │
       └─────────────────────────────────────────┘
               │
               │
       ┌───────▼──────────────────────────┐
       │ Admin views in Telegram Topic 1  │
       │ (live mirror, 1 msg/turn)        │
       │                                  │
       │ Admin can reply in Topic 1       │
       │ → Takeover → Lead sees reply      │
       └────────────────────────────────┘
```

## Main Assistant Capabilities (June 20, 2026)

Five new tool domains extend the `main_assistant` agent (`lib/agent/tools/main-assistant/`):

| Domain | Tools | Purpose |
|--------|-------|---------|
| **Templates** (F4b) | `list_message_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `render_template` | Reusable message library with `{{name}}`, `{{email}}`, `{{listing_title}}`, `{{agency_name}}` placeholders. Unresolved placeholders left literal + warned. |
| **Visitor Pool** (F1) | `list_visitor_pool`, `read_visitor_thread`, `identify_visitor` | Anonymous visitor management. Identification requires name OR email; ephemeral if neither. No merge. |
| **Telegram Search** (F4c) | `search_messages` (extended) | Extended search with channel filter ('web'|'email'|'telegram'|'all'). Tags results with `surface: 'dm'` or `'group'`. Fixed cross-agency leak. |
| **GDPR Consent** (F4d) | `set_consent`, `view_consent_status`, `view_audit_history`, `export_lead_data` | Consent management + compliance audit. Audit is append-only; erasure is hard-delete with no PII trace. |
| **Scheduled Messages** (F4a) | `schedule_message`, `list_scheduled_messages`, `cancel_scheduled_message` | Schedule messages in Europe/Paris timezone. Delivery via background loop (gated by `RUN_SCHEDULER` env). At-least-once, retry cap 3, uses `FOR UPDATE SKIP LOCKED` for multi-instance safety. Telegram group messages cannot be remotely deleted on erasure (documented limitation). |

All tools are scoped by `agency_id` and registered in `lib/agent/tools/main-assistant/index.ts` (barrel).

## Scheduler Infrastructure (Instrumentation Loop)

The scheduler runs inside the Next.js app process:
- **Host:** `lib/instrumentation.ts` `register()` hook (runs in dev + prod).
- **Gated by:** Env `RUN_SCHEDULER` (default off; enable on exactly one app instance).
- **Safety:** `FOR UPDATE SKIP LOCKED` ensures multi-instance safety.
- **Interval:** Polls due scheduled messages every ~30s.
- **Error handling:** Retry up to 3 attempts with exponential backoff before marking failed.

Prod docker-compose has only `db` + `app`; the scheduler runs in the app server (no separate worker needed).

## Database Migrations (Idempotent Schema)

Schema evolution uses idempotent migrations in `drizzle/`:

| Migration | Tables | Date |
|-----------|--------|------|
| `0002_sweet_cannonball.sql` | Catch-up baseline (idempotent) + `message_templates`, `lead_consents`, `audit_log`, `scheduled_messages` | 2026-06-20 |

**Key change:** Migrations now use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded constraints for safety on partial schema state. Docker entrypoint runs migrate from a BAKED `/migrate` image copy, so schema changes require `docker compose build` to reach boot.

## Key Files

- `lib/agency-context.ts` — Host → agency resolver.
- `middleware.ts` — Set `x-agency-id` header.
- `lib/db/agencies.ts` — Agency queries + helpers.
- `lib/db/agency-telegram-links.ts` — Telegram token + group binding.
- `lib/db/lead-telegram-topics.ts` — Per-lead topic storage.
- `lib/telegram/{route-group-message,group-send-queue,handle-lead-telegram-update,notify-agency,verify-agency-group}.ts` — Telegram group handlers & queue.
- `app/api/admin/*` — IDOR guards on all resource loads.
- `lib/db/{message-templates,audit-helpers,consents,audit-log,scheduled-messages}.ts` — F4a–d helpers.
- `lib/agent/tools/main-assistant/{templates,visitor-pool,gdpr,scheduled-messages}.ts` — F4a–d tools.
- `lib/scheduling/{deliver-due-scheduled-messages,scheduled-message-loop,paris-time}.ts` — Scheduler loop + delivery + timezone.
- `lib/instrumentation.ts` — Scheduler registration (gated by `RUN_SCHEDULER`).

## Security Fixes Included (June 13, 2026)

| ID | Issue | Fix |
|----|----|------|
| C1 | Spoofable x-agency-id header | Client header unconditionally stripped; server-resolved only. |
| C2 | Cross-tenant IDOR in operator chat | Added `lead.agency_id !== admin.agency_id` check; 404 on mismatch. |
| C3 | Cross-tenant IDOR in actions route | Fetch resource by ID, verify `agency_id` before mutation. |
| C4 | Cross-tenant read in stream/SSE | Added agency check before opening SSE stream. |
| I2 | IPv6 dev-host parsing | Fixed bracket notation in `agency-context.ts`. |
| I1 | Admin route guard sweep | Added ownership checks to all resource-mutating routes. |

## Version History

- **2026-06-13**: Multi-tenant GA + agency-Telegram control surface. Telegram shifted from per-admin DM sync to per-agency group with 2-topic-per-lead model. 4 critical IDOR fixes + 2 important improvements.
