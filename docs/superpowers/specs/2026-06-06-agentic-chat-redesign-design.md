# Design — Agentic Chat Redesign (lead-agent-chat)

**Date:** 2026-06-06
**Status:** Approved direction (Hướng A), pending detailed-section review
**Predecessor:** `lead-qualification-agent` (form/pipeline-driven). This is a UX + architecture
redesign of the same business domain (French real-estate lead qualification), not a fork.

---

## 1. Goal & motivation

The predecessor platform qualifies inbound real-estate leads through a fixed pipeline
(`handleInbound` → parallel qualification extraction → durable Workflow for slot booking),
with a form-heavy UX and lots of clicking.

The new idea keeps the **same business** but rebuilds the UX to be **agentic and chat-first**
(ChatGPT-style): fewer clicks, the agent drives the conversation and the actions.

Concretely:

- The home page is a **list of properties (listings)**. A visitor opens a listing and **chats**
  with an agent about it.
- The agent **answers questions about the property** while **naturally extracting qualification
  criteria** to verify the lead's potential status — instead of asking the user to fill forms.
- Anonymous chat works immediately (no login). Login (email / magic link) is **optional**, only
  to persist history and attach a lead identity. ChatGPT-style.
- After qualification, the agent still handles the **full downstream** — proposing viewing slots,
  booking on Google Calendar, and handing off to a human — but all **through conversation**.
- Admins interact with their own **agent assistant** on the platform, and the **same assistant
  is available via Telegram (synced session)**. Admins also receive **lead notifications** and can
  **take over** a lead conversation directly from Telegram.

---

## 2. Architecture (Hướng A — pure tool-using agent)

The core is a **stateless-per-turn agent loop**. There is no fixed business pipeline; the
"intelligence" lives in the agent + its tools. The model decides, on every turn, whether to
answer, ask a qualifying question, or call a tool.

```
Inbound message  (web chat | email | telegram)
  → runAgentTurn(conversationId, message, actor)
      1. Load conversation history + lead qualification state from DB
      2. Build system prompt (persona, listing context, configured criteria, current qual state)
      3. generateText({ model, tools, stopWhen: stepCountIs(N) })   // AI SDK multi-step loop
           the agent may call tools, read their results, and continue, all within one turn
      4. Persist assistant message + tool calls/results
      5. Dispatch the reply back to the originating channel (SSE for web, email, telegram)
```

**Why no durable Workflow engine (vs. the predecessor's Workflow DevKit):**
In a chat-first model the "wait for the lead to choose a slot" step happens **naturally across
chat turns**. All state lives in the DB keyed by `conversation`, so each inbound message simply
re-runs the agent loop with full history + current qualification state. This also makes Telegram
"session sync" trivial — any client reading the same `conversation` sees the same context.
Workflow DevKit is therefore **dropped for the MVP**.

### 2.1 Two personas, one tool/data layer

| Persona | Who | Surfaces | Tools available |
|---|---|---|---|
| **Lead-facing agent** | Anonymous or logged-in visitor chatting about one listing | Web chat panel | listing Q&A, qualification, slot proposal/booking, handoff, notify-admin |
| **Admin agent** | Authenticated admin assistant | Platform chat + Telegram | lead/conversation queries, draft/send reply, takeover, update criteria/config, listing management |

Both share the same tool implementations in `lib/agent/tools/` and the same data layer
(`lib/db`). The difference is which tool subset is exposed and which system prompt is used.

### 2.2 Tool catalogue (initial)

**Lead-facing tools**
- `get_listing(listing_id)` — full details of the current property.
- `search_listings(query)` — find other matching properties (price/area/rooms).
- `record_qualification(values, status, reason)` — write extracted criterion values + a computed
  potential status (e.g. `hot|warm|cold`) + a short reason onto the lead. Criteria set is
  admin-configured (see §4).
- `get_available_slots(listing_id)` — read candidate viewing slots (calendar / mock).
- `book_viewing(listing_id, slot_iso, contact)` — persist a viewing + create the Google Calendar
  event. Requires a contact (email) — prompts login/contact capture if anonymous.
- `request_handoff(reason)` — flag the conversation for human follow-up.
- `notify_admin(summary)` — push a notification to the admin (platform + Telegram).

**Admin-only tools**
- `query_leads(filter)` — list/search leads by status, score, listing, recency.
- `get_conversation(lead_id)` — read a lead's full thread + qualification state.
- `draft_reply(lead_id, intent)` / `send_reply(lead_id, content)` — compose / send a message to a
  lead on their channel.
- `takeover_conversation(lead_id)` — switch a conversation to manual (admin) mode.
- `update_criteria(criteria)` / `update_config(patch)` — edit the agency's qualification criteria
  and tone/config in natural language.

### 2.3 Stack (keeps the predecessor's format)

- **Next.js 16 + React 19**, App Router.
- **AI SDK 5** via Vercel AI Gateway (provider-agnostic via `LLM_MODEL`), using **multi-step
  tool-calling** (`tools` + `stopWhen`).
- **Drizzle ORM + Postgres**.
- **Tailwind v4 + shadcn/ui** components.
- **Telegram** via Bot API webhook (grammY).
- **Sendgrid** (inbound parse + outbound) and **Google Calendar** (service account) — kept, with
  mock fallbacks in dev, same as predecessor.
- Same conventions: `@/*` path alias, `lib/` services, `app/api/*` route handlers, Drizzle
  `lib/db/schema.ts`, `scripts/seed.ts`, Docker dev/prod compose.

---

## 3. Personas, entry points & channels

### 3.1 Lead-facing (visitor)

1. **Home = public listing list.** Cards with price/surface/rooms/photo.
2. Click a listing → listing detail + **chat panel** (anonymous chat starts immediately).
3. A `conversation` row is created (type `lead`, `listing_id` set, no lead attached yet).
4. The agent answers about the property and naturally works through the configured criteria.
5. **Optional login** (email magic link) persists the conversation and attaches/creates a `lead`.
   Booking a viewing requires a contact email (captured inline or via login).
6. When qualified, the agent proposes slots in chat → on the next turn interprets the choice →
   books → confirms. If escalation is warranted, it calls `request_handoff` + `notify_admin`.

### 3.2 Admin

1. Admin logs into the platform → **agent-assistant chat** (e.g. "which leads are hottest?",
   "draft a reply for lead X", "change the qualification criteria to add preferred area").
2. **Telegram linking:** admin runs `/start <token>` (token issued from the platform). The
   Telegram chat is bound to the admin and becomes a second client of the **same** assistant
   conversation — open it on the platform or Telegram, same context/history.
3. **Notifications + takeover:** when a lead conversation needs attention (`request_handoff`
   fired, or a hot lead), the bot pushes the lead thread to Telegram. The admin can reply on
   Telegram; that message is routed straight to the lead's channel (web via SSE, or email),
   and the conversation switches to manual/takeover mode until released.

### 3.3 Channel routing

A `conversation` has a `primary_channel`. Replies are dispatched by channel:
- `web` → stored + streamed to the open browser via SSE.
- `email` → sent via Sendgrid.
- The **admin assistant** conversation is dual-client (web + telegram); each new turn is
  broadcast to whichever clients are connected (SSE for web, Bot API send for Telegram).

---

## 4. Configurable qualification

Qualification criteria are **defined by the admin in natural language** (per agency), not
hard-coded. The agent uses them to ask questions and compute a potential status.

- `agency_config.qualification_criteria` is a `jsonb` list of criterion definitions, e.g.
  `[{ key: "budget", label: "Budget range", hint: "approx € the buyer can spend" }, ...]`.
- The lead's extracted answers are stored as a `jsonb` map `criterion.key → value` on the lead,
  plus a computed `potential_status` (`hot|warm|cold`) and `score_reason`.
- `record_qualification` is the single write path: the agent decides values + status + reason
  from the conversation and the criteria definitions, then persists them.
- The admin can edit criteria via the assistant (`update_criteria`) or a config screen; new
  criteria take effect on the next turn (system prompt is rebuilt from config each turn).

This generalises the predecessor's fixed five fields (budget / financing / timeline /
intended_use / is_decision_maker) into an admin-owned set, while the seed ships those five as the
default criteria so existing behaviour is preserved out of the box.

---

## 5. Data model (changes from predecessor)

Kept tables: `listings`, `viewing_slots`, `handoff_rules`, `admins`, `admin_sessions`,
`lead_sessions`, `lead_magic_links`, `agency_config`.

**New: `conversations`** — first-class, replaces the implicit lead↔messages 1:1.
```
id              uuid pk
type            varchar        -- 'lead' | 'admin_assistant'
lead_id         uuid null fk   -- null while anonymous
admin_id        uuid null fk   -- set for admin_assistant
listing_id      varchar null   -- the property under discussion (lead chats)
primary_channel varchar        -- 'web' | 'email' | 'telegram'
mode            varchar        -- 'agent' | 'manual' (takeover)
created_at, updated_at
```

**Changed: `messages`** — now hangs off `conversation_id` (not `lead_id`); gains tool transparency.
```
conversation_id uuid fk        -- was lead_id
role            varchar        -- 'user' | 'assistant' | 'admin' | 'tool'
content         text
tool_calls      jsonb null     -- what the agent invoked this turn
tool_results    jsonb null
is_draft        boolean
timestamp
```

**Changed: `leads`** — qualification generalised.
```
... identity fields kept (channel, email, name, listing_id, language, status) ...
qual_values      jsonb         -- { criterionKey: value }   (replaces qual_budget/... columns)
potential_status varchar null  -- 'hot' | 'warm' | 'cold'
score_reason     text null
-- drop: qual_budget, qual_financing, qual_timeline, qual_intended_use,
--       qual_is_decision_maker, qual_missing, workflow_run_id, slot_hook_token
```

**Changed: `agency_config`** — `qualification_criteria` becomes `jsonb` of criterion objects
(`{key,label,hint}`) instead of `jsonb<string[]>`.

**New: `admins.telegram_user_id`** (varchar, null) + **`telegram_link_tokens`** table
(`token_hash`, `admin_id`, `expires_at`, `consumed_at`) for `/start <token>` linking.

---

## 6. Error handling & guardrails

Pure tool-driven agents need explicit rails:

- **Step cap:** `stopWhen: stepCountIs(N)` (e.g. 6) so a turn can't loop forever on tools.
- **Tool validation:** every tool input is a Zod schema; invalid args are returned to the model
  as a tool error so it can retry, not thrown to the user.
- **Side-effect confirmation:** irreversible/outbound tools (`book_viewing`, `send_reply`) require
  a contact and are idempotent (dedupe by conversation + slot / message hash).
- **No-contact booking:** `book_viewing` without an email returns a "need contact" result; the
  agent then asks for it / offers login rather than failing.
- **Provider/calendar/email failures:** mock fallbacks in dev; in prod, tool returns a structured
  error and the agent surfaces a graceful message + `notify_admin`.
- **Telegram webhook auth:** verify `TELEGRAM_WEBHOOK_SECRET`; bind chats to admins only via a
  valid link token.
- **Takeover safety:** while `mode = 'manual'`, the lead-facing agent does not auto-reply; it only
  records the lead's messages and notifies the admin.

---

## 7. Testing strategy

- **Unit:** each tool (pure logic + DB effect) with a test Postgres; qualification status
  computation; criteria config parsing.
- **Agent-loop integration:** seed a conversation, feed scripted user turns, assert the agent
  calls the expected tools and persists the expected state (mock the LLM with deterministic
  tool-call fixtures where needed, plus a few live-model smoke tests behind a flag).
- **Channel routing:** web SSE broadcast, email dispatch, Telegram send — mocked transports.
- **Telegram linking + takeover:** token issue → `/start` → bind → assistant continuity → lead
  takeover round-trip.
- **E2E demo flow:** anonymous chat about a listing → qualified → slot booked → calendar event;
  plus a handoff path that notifies Telegram and is taken over.

---

## 8. Out of scope (MVP)

- Durable/resumable background workflows (dropped; chat turns cover async).
- Multi-agency tenancy beyond a single seeded agency.
- Payment / contract / e-signature steps.
- Voice or WhatsApp channels (Telegram + web + email only).
- Fine-grained admin RBAC (single admin role).
