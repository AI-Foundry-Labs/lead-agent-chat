# lead-agent-chat — Agentic Chat for Real-Estate Lead Qualification

Chat-first, agentic redesign of [`lead-qualification-agent`](https://github.com/AI-Foundry-Labs/lead-qualification-agent).
Same business (French real-estate lead qualification), new UX: instead of forms and clicks, a
visitor browses a list of properties, opens one, and **chats** with an AI agent that answers
questions about the property while naturally qualifying the lead, proposing viewings, booking on
Google Calendar, and handing off to a human — all through conversation. Admins drive their own
agent assistant from the platform or **Telegram** (synced session), with lead notifications and
takeover.

## Status

📋 **Planning.** No application code yet. Start with the design and plan:

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

## Setup (once Phase 0 lands)

```bash
cp .env.example .env.local   # AI_GATEWAY_API_KEY, DATABASE_URL required; others have mock fallbacks
npm install
npm run db:push
npm run db:seed
npm run dev
```
