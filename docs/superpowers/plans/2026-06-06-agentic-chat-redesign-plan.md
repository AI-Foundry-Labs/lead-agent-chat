# Implementation Plan — Agentic Chat Redesign (lead-agent-chat)

**Date:** 2026-06-06
**Design:** [`../specs/2026-06-06-agentic-chat-redesign-design.md`](../specs/2026-06-06-agentic-chat-redesign-design.md)
**Approach:** Hướng A — pure tool-using agent loop, no durable workflow engine.

This plan is organised in phases. Each phase is independently shippable and verifiable. The goal
of the MVP is the demo flow in §Phase 6.

---

## Phase 0 — Project scaffold (keep predecessor format)

- [ ] Scaffold Next.js 16 + React 19 (App Router), TypeScript, `@/*` alias, Tailwind v4 +
      shadcn/ui — mirroring the predecessor's `tsconfig`, `next.config.ts`, `components.json`.
- [ ] Add dependencies: `ai` (AI SDK 5), `@ai-sdk/*` providers, `drizzle-orm`, `postgres`,
      `drizzle-kit`, `zod`, `grammy` (Telegram), `googleapis`, `@sendgrid/mail`, `bcryptjs`.
- [ ] Copy infra format: `Dockerfile`, `docker-compose.yml` (dev) + `docker-compose.prod.yml`,
      `docker-entrypoint.sh`, `.github/workflows`, `drizzle.config.ts`, `.env.example` (already
      added), `.gitignore` (already added).
- [ ] `package.json` scripts: `dev`, `build`, `start`, `typecheck`, `db:push`, `db:generate`,
      `db:seed`.

**Verify:** `npm run dev` boots; `npm run typecheck` passes.

## Phase 1 — Data layer

- [ ] `lib/db/schema.ts`: `conversations`, `messages` (conversation_id + tool_calls/results),
      `leads` (qual_values jsonb, potential_status, score_reason), `agency_config`
      (qualification_criteria as criterion objects), `listings`, `viewing_slots`, `handoff_rules`,
      `admins` (+ telegram_user_id), `admin_sessions`, `lead_sessions`, `lead_magic_links`,
      `telegram_link_tokens`.
- [ ] `lib/db/index.ts`: typed query helpers (createConversation, getConversation, addMessage,
      getMessages, createLead, updateLead, getLeadByEmail, listings/config/handoff queries,
      telegram link helpers).
- [ ] `lib/types.ts`: domain types + Zod schemas (criterion, qualification values, tool inputs).
- [ ] `scripts/seed.ts`: seed agency config with the default 5 criteria (budget, financing,
      timeline, intended_use, decision_maker), demo listings, 2 handoff rules, one admin.

**Verify:** `db:push` creates tables; `db:seed` populates; query helpers covered by unit tests.

## Phase 2 — Agent core (the loop + tools)

- [ ] `lib/llm.ts`: model resolution from `LLM_MODEL` via AI Gateway (port from predecessor).
- [ ] `lib/agent/prompts.ts`: `buildLeadSystemPrompt` (persona, listing context, configured
      criteria, current qual state) and `buildAdminSystemPrompt`.
- [ ] `lib/agent/tools/`: implement lead-facing tools (`get_listing`, `search_listings`,
      `record_qualification`, `get_available_slots`, `book_viewing`, `request_handoff`,
      `notify_admin`) and admin tools (`query_leads`, `get_conversation`, `draft_reply`,
      `send_reply`, `takeover_conversation`, `update_criteria`, `update_config`). Each: Zod input,
      pure-ish handler over `lib/db` + integrations, structured result.
- [ ] `lib/agent/run.ts`: `runAgentTurn(conversationId, message, actor)` — load state, build
      prompt + tool subset by persona, `generateText({ tools, stopWhen: stepCountIs(6) })`,
      persist messages + tool calls/results, return reply + dispatch instruction.

**Verify:** integration tests drive scripted turns and assert tool calls + persisted state
(deterministic tool-call fixtures + a flagged live-model smoke test).

## Phase 3 — Integrations (calendar, email, SSE)

- [ ] `lib/calendar.ts`, `lib/email.ts`: port from predecessor with dev mock fallbacks.
- [ ] `lib/events.ts`: SSE broadcast per conversation (port `broadcastDashboardUpdate` pattern).
- [ ] `app/api/chat/route.ts` (web inbound) + `app/api/chat/stream/route.ts` (SSE).
- [ ] `app/api/email/route.ts` (Sendgrid inbound parse → `runAgentTurn`).

**Verify:** booking creates a (mock) calendar event; email inbound routes through the agent; SSE
streams a reply to the browser.

## Phase 4 — Lead-facing UX (chat-first)

- [ ] `app/page.tsx` + `components/listings/`: public listing list (cards).
- [ ] `app/listings/[id]/page.tsx`: listing detail + chat panel; anonymous chat starts a
      `conversation`; messages stream via SSE.
- [ ] Inline contact capture + optional magic-link login (`app/api/auth/lead-*` ported).
- [ ] Render tool activity subtly (e.g. "booking your viewing…", slot confirmation card).

**Verify:** anonymous user can open a listing, chat, get qualified, and book a viewing end-to-end.

## Phase 5 — Admin assistant + Telegram sync

- [ ] Admin auth (port `lib/auth.ts`, `app/admin/login`, `admin_sessions`).
- [ ] `app/admin/page.tsx`: admin assistant chat (uses admin tool subset) + a lightweight lead
      list view fed by `query_leads`.
- [ ] `lib/telegram.ts` + `app/api/telegram/route.ts`: grammY webhook (verify
      `TELEGRAM_WEBHOOK_SECRET`); `/start <token>` binds chat to admin via `telegram_link_tokens`.
- [ ] Assistant session sync: admin_assistant conversation is dual-client (web SSE + Telegram
      send); each turn broadcast to connected clients.
- [ ] Notifications + takeover: `notify_admin`/`request_handoff` push the lead thread to Telegram;
      admin reply on Telegram routes to the lead's channel and sets `mode = 'manual'`.

**Verify:** link Telegram from platform; ask the assistant a question on Telegram and continue it
on the web; trigger a handoff and take over a lead from Telegram.

## Phase 6 — Demo flow & hardening

- [ ] **Autonomous booking:** open a Marais listing, chat (budget/financing/timeline/use/decision
      surfaced naturally) → agent proposes slots → pick one → booking confirmed.
- [ ] **Handoff:** open a listing, message something matching a handoff rule → agent escalates →
      Telegram notified → admin takes over.
- [ ] **Live config:** admin tells the assistant to add a new qualification criterion → next lead
      turn uses it.
- [ ] Guardrails pass: step cap, tool input validation, idempotent booking/send, takeover safety.
- [ ] README "Demo flow" section finalised.

**Verify:** all three demo flows run clean; `typecheck` + tests green.

---

## Sequencing notes

- Phases 0→3 are foundational and mostly sequential. Phase 4 (lead UX) and the admin half of
  Phase 5 can proceed in parallel once Phase 2/3 exist, since they share the tool/data layer.
- Telegram (Phase 5) depends only on the agent core + admin auth, not on lead UX.
- Each phase ends with a `typecheck` + targeted tests gate before moving on.
