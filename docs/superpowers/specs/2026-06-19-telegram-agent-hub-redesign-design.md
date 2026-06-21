# Telegram Agent Hub Redesign — Design

**Date:** 2026-06-19
**Status:** Approved (design) — pending implementation plan
**Branch:** `telegram`
**Scope:** Replace the per-lead Telegram topic explosion with a single Master-topic hub driven by an `/agent` command, and route all notifications through that chat channel as subagent-composed messages persisted to two DB histories.

## 1. Problem & Goal

Today each lead auto-creates **two** forum topics in the agency supergroup (💬 Conversation + 🤖 Assistant) plus one agency Master topic (see `lib/telegram/lead-topics.ts`, `lib/db/lead-telegram-topics.ts`). With N leads this is 2N+1 tabs — unusable at scale. Notifications are split and inconsistent: `notifyAgency` queues to a per-lead topic without DB persistence; `notifyAdminsInChat` writes only to the main-assistant history; `notifyAdmins` is a fire-and-forget DM.

**Goal (user-approved):**
1. One conversational hub = the **Master topic**. The admin picks which subagent to talk to via an `/agent` command instead of switching topics.
2. Selectable subagents: **main-assistant** and **operator(lead)**.
3. Notifications/alerts are pushed into the **same chat channel**, **composed by the relevant subagent (operator of the lead)**, and after sending are **persisted to BOTH** histories: `operator(lead)↔admin` AND `main-assistant↔admin`.
4. Stop the per-lead tab explosion.

**Constraint (confirmed):** exactly **one admin per agency** (`admins.agency_id` is 1:N but product runs 1 admin). No multi-admin disambiguation needed. Active-session selection is scoped to the **whole agency**.

## 2. Architecture

### 2.1 Hub = Master topic + `/agent`

All admin↔agent interaction happens in the agency group's **Master topic** (`agencies.telegram_master_topic_id`). A new command layer:

- `/agent` (no args) → bot replies with an **inline keyboard**: a `🤖 Main` button + buttons for recent/active leads (label = lead name or masked phone/email). Selecting one sets the active session.
- `/agent main` → set active session to main-assistant.
- `/agent lead <query>` → resolve a lead by name/email (partial, case-insensitive via `search_leads`-style query); if multiple, show a picker; set active session to that lead's operator.
- `/agent` also re-shows current active session at the top ("Currently: 🤖 Main").

A non-command text message in the Master topic is dispatched to the **currently-active subagent**:
- active = `main` → `runAgentTurn(mainAssistantConvId, text, {type:'main_assistant', adminId, adminName})`
- active = `operator:<leadId>` → `runAgentTurn(operatorConvId, text, {type:'operator', leadId, adminId, adminName})`

The reply is posted back into the Master topic, **prefixed with an agent label** so the admin always knows who answered:
- `🤖 Main — …`
- `👤 Operator · <leadName> — …`

If no active session is set when a plain message arrives, the bot prompts the admin to run `/agent` first (does not guess).

### 2.2 Active-session state (agency-scoped)

New table `telegram_agent_sessions`:

| column | type | notes |
|---|---|---|
| `agency_id` | uuid PK | references agencies, onDelete cascade |
| `agent_kind` | varchar(20) | `'main'` \| `'operator'` |
| `lead_id` | uuid null | set when `agent_kind='operator'`; references leads, onDelete set null |
| `updated_at` | timestamptz | |

DB helpers (in a new `lib/db/telegram-agent-sessions.ts`): `getAgentSession(agencyId)`, `setAgentSession(agencyId, {agent_kind, lead_id})`. Single row per agency (upsert). Scoped to agency per the approved decision.

### 2.3 Notification redesign

New helper `pushAgentNotification({ agencyId, leadId, event })` in `lib/notify.ts` (or a new `lib/agent/push-agent-notification.ts`):

1. **Compose** the message as the **operator of the lead** — reuse `generateStaffReport(event, lang)` (already LLM-driven, report-style) so the text reads as the operator's internal note.
2. **Send** to the chat channel = the agency **Master topic** (via the existing group-send queue / `enqueueGroupSend`), label-prefixed `👤 Operator · <leadName>`.
3. **Dual-write to DB** (the core requirement):
   - `addMessage(operatorConvId, { role:'assistant', content })` — resolve via `getOrCreateLeadOperator(leadId, agencyId)`.
   - `addMessage(mainAssistantConvId, { role:'assistant', content })` — resolve via `getOrCreateMainAssistant(adminId, agencyId)` (the agency's single admin).
4. `broadcastConversationUpdate` for both conversations so the web UI stays live.

This **replaces** the current `notifyAgency` + `notifyAdminsInChat` split at the call sites in `lib/agent/run.ts` (manual-mode, handoff) and `lib/agent/tools/operator-lead-actions.ts` (booking, handoff_requested). `notifyAdmins` (raw DM) is kept only for non-lead-scoped system alerts.

Each history holds its own message object (no cross-conversation dedup needed — they are independent threads; the web UI renders each separately). This is intended, not a bug.

### 2.4 Reduce tabs

- **Stop auto-creating** the per-lead 💬/🤖 topics: `getOrCreateLeadTopics` is no longer called on lead activity. Per-lead lead↔agent reports that used to post to the 💬 topic now flow through `pushAgentNotification` into the Master topic, or are simply persisted to the lead conversation without a Telegram topic.
- Keep `lead_telegram_topics` table + its handlers **dormant** (not deleted) so the user can re-enable per-lead topics later. Inbound routing for existing per-lead topics remains functional for any already-created topics, but no new ones are provisioned.

## 3. Inbound routing changes

`lib/telegram/route-group-message.ts` (currently routes Master / Conversation-topic / Assistant-topic):

- **Master topic branch** becomes the hub: detect `/agent…` commands → command handler; detect inline-keyboard callback queries (`callback_query`) for agent/lead selection → set session; otherwise → dispatch text to active subagent (§2.1).
- **Per-lead topic branches**: unchanged for already-existing topics (dormant; no new provisioning).
- Add a callback-query handler path in `app/api/telegram/route.ts` / `handleTelegramUpdate` if not already present (inline keyboard buttons emit `callback_query`, not messages).

Admin resolution: single admin per agency → resolve via the agency's only admin (`resolveActingAdmin` fallback already returns the primary admin). No per-message author disambiguation.

## 4. New / changed files (estimate)

**New:**
- `lib/db/telegram-agent-sessions.ts` — table helpers (get/set), exported via `lib/db` barrel
- `lib/telegram/agent-command.ts` — parse/handle `/agent`, build inline keyboard, handle selection callbacks
- `lib/telegram/agent-hub-dispatch.ts` — dispatch Master-topic text to active subagent + label replies
- `lib/agent/push-agent-notification.ts` — compose (operator) + send + dual-write

**Modified:**
- `lib/db/schema.ts` — add `telegram_agent_sessions` table
- `lib/telegram/route-group-message.ts` — Master-topic hub routing
- `app/api/telegram/route.ts` / `handle-lead-telegram-update.ts` — callback_query handling
- `lib/agent/run.ts` + `lib/agent/tools/operator-lead-actions.ts` — swap notify calls → `pushAgentNotification`
- Stop calling `getOrCreateLeadTopics` on lead activity (locate call sites)

Each new file kept < 200 LOC.

## 5. Data flow examples

**Admin talks to an operator:**
`/agent` → tap `👤 Marie` → session = operator:marieId → admin types "propose a viewing this week" → operator turn runs → reply posted to Master topic as `👤 Operator · Marie — …`, persisted to operator(Marie) conversation.

**Handoff alert:**
Lead triggers a handoff rule → `pushAgentNotification({agencyId, leadId, event:{kind:'handoff',…}})` → operator composes report → posted to Master topic `👤 Operator · Marie — Handoff: price negotiation…` → written to BOTH operator(Marie)↔admin and main-assistant↔admin histories → both visible in web UI.

## 6. Guardrails & safety

- Telegram webhook auth unchanged (`TELEGRAM_WEBHOOK_SECRET`).
- `/agent lead <query>` only matches leads within the acting admin's `agency_id` (tenant scope).
- Notification send failures must not break the lead turn (wrap Telegram send in try/catch, as today); DB dual-write happens regardless of Telegram delivery.
- Inline-keyboard callbacks validated against the agency's leads before setting session.

## 7. Testing

- Unit: `telegram-agent-sessions` get/set upsert; `pushAgentNotification` dual-writes to both conversation ids.
- Routing: Master-topic text with active=main vs active=operator dispatches to correct actor; `/agent` with no args returns keyboard; callback sets session.
- Contract/eval: extend existing harness — handoff event produces a message in BOTH operator and main-assistant histories.
- `npm run typecheck` + build green. Manual smoke via Telegram once `TELEGRAM_BOT_TOKEN` group is linked.

## 8. Migration / compatibility

- One new table via `db:push` (additive; no backfill — defaults to no active session, admin runs `/agent`).
- Existing per-lead topics remain readable; just not auto-created. No destructive schema change.
- Web admin UI unchanged structurally; benefits from dual-written notifications appearing in both threads.

## 9. Unresolved questions

1. Recent-lead list for `/agent` keyboard — order by last activity, cap at N (e.g. 8 buttons). Confirm N and ordering during implementation.
2. Should the Master-topic label prefix also be stored in the DB message (e.g. a `source`/`author_label` field) or only rendered in Telegram? Default: Telegram-only prefix; DB stores plain content. Revisit if web UI needs the attribution.
3. Per-lead lead↔agent verbatim mirror (old 💬 topic) is dropped — confirm the admin no longer needs the raw lead transcript in Telegram (it remains in the web UI lead conversation).
4. `/agent` in DM (not just Master topic) — deferred; user opted to center on Master and fine-tune later.
