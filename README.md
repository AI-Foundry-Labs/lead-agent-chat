# lead-agent-chat — Agentic Chat for Real-Estate Lead Qualification

Chat-first, agentic redesign of [`lead-qualification-agent`](https://github.com/AI-Foundry-Labs/lead-qualification-agent).
Same business (French real-estate lead qualification), new UX: instead of forms and clicks, a
visitor browses a list of properties, opens one, and **chats** with an AI agent that answers
questions about the property while naturally qualifying the lead, proposing viewings, booking on
Google Calendar, and handing off to a human — all through conversation. Admins drive their own
agent assistant from the platform or **Telegram** (synced session), with lead notifications and
takeover.

## Status

✅ **MVP implemented.** All six plan phases are in place; `npm run build` and
`npm run typecheck` pass, and `db:push` + `db:seed` run clean against Postgres.

- Design: [`docs/superpowers/specs/2026-06-06-agentic-chat-redesign-design.md`](docs/superpowers/specs/2026-06-06-agentic-chat-redesign-design.md)
- Plan: [`docs/superpowers/plans/2026-06-06-agentic-chat-redesign-plan.md`](docs/superpowers/plans/2026-06-06-agentic-chat-redesign-plan.md)

## Planned stack (keeps predecessor format)

- Next.js 16 + React 19 (App Router)
- AI SDK 5 via Vercel AI Gateway (provider-agnostic) — **multi-step tool-calling**
- Drizzle ORM + Postgres
- Tailwind v4 + shadcn/ui
- Telegram Bot API (grammY) · Sendgrid · Google Calendar (service account)

## Architecture in one paragraph

A **stateless-per-turn agent loop** (`runAgentTurn`) replaces the predecessor's fixed pipeline and
durable workflow. Every inbound message (web / email / Telegram) loads conversation + qualification
state from Postgres, runs the model with a tool set, persists the result, and dispatches the reply
to its channel. Because all state lives in the DB keyed by `conversation`, "waiting for the lead to
pick a slot" is just the next chat turn, and Telegram session-sync is automatic. See the design doc
for details.

## Setup

```bash
cp .env.example .env         # set AI_GATEWAY_API_KEY + DATABASE_URL; others have mock fallbacks
npm install
docker compose up -d db      # local Postgres on host port 5442 (or point DATABASE_URL elsewhere)
npm run db:push              # create tables
npm run db:seed              # agency config (5 criteria), 3 listings, 2 handoff rules, 1 admin
npm run dev                  # http://localhost:3000
```

Or run the whole stack in Docker: `docker compose up` (app on `:3030`, auto push+seed).

## Project layout

```
lib/db/            schema (conversations, messages, leads, …) + per-domain query helpers
lib/agent/run.ts   runAgentTurn — the stateless-per-turn loop (generateText + stopWhen)
lib/agent/tools/   lead-tools.ts + admin-tools.ts (Zod-validated, persona-scoped)
lib/agent/prompts.ts   buildLeadSystemPrompt / buildAdminSystemPrompt (rebuilt each turn)
lib/{calendar,email,telegram,dispatch,events,notify}.ts   integrations + channel routing
app/                listings + chat UI (lead) and /admin assistant (admin)
app/api/chat        web inbound (POST) + SSE stream; /api/email, /api/telegram, /api/admin/*
```

## Demo flows

1. **Autonomous booking** — open the Marais listing, chat naturally. The agent answers
   property questions, calls `record_qualification` as it learns budget/financing/etc.,
   then `get_available_slots` → `book_viewing` (asking for a contact email inline). A
   calendar event is created (mock in dev) and a confirmation card appears in chat.
2. **Handoff** — mention price negotiation, or open the Vincennes house. A configured
   handoff rule fires: the conversation switches to `manual`, admins are notified
   (Telegram agency group if linked), and the lead-facing agent stops auto-replying.
3. **Live config** — log in at `/admin`, tell the assistant "ajoute un critère quartier
   préféré". `update_criteria` rewrites the agency criteria; the next lead turn uses it.
4. **Telegram agency group** — in `/admin` click *Lier Telegram*, send `/link <token>` to
   the bot in your agency's supergroup (forum). Two auto-created topics per lead:
   **💬 Conversation** (live lead↔agent mirror + admin takeover) and **🤖 Assistant**
   (internal copilot). Admins reply in the group to take over; `/resume` returns control
   to the agent. Note: existing visitor lead-DM flow still works in parallel.

## Guardrails

- **Step cap:** `stopWhen: stepCountIs(6)` bounds tool loops per turn.
- **Tool validation:** every tool input is a Zod schema; invalid args return a tool error
  to the model instead of throwing to the user.
- **No-contact booking:** `book_viewing` without an email returns `need_contact` so the
  agent asks for one rather than failing.
- **Idempotent booking:** a conversation can't double-book the same slot.
- **Takeover safety:** while a conversation is `manual`, the agent records the lead's
  messages and notifies admins but never auto-replies.
- **Telegram webhook auth:** verified against `TELEGRAM_WEBHOOK_SECRET`; chats bind to
  admins only via a single-use, short-lived link token.
