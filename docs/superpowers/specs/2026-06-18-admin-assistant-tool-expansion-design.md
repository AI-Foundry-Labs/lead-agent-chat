# Admin Assistant Tool Expansion — Design

**Date:** 2026-06-18
**Status:** Approved (design) — pending implementation plan
**Author:** brainstorming session
**Scope:** Expand the admin `main-assistant` agent toolset to full admin-co-pilot parity + modularize the oversized tool file.

## 1. Problem & Goal

The admin main-assistant agent (`lib/agent/tools/main-assistant-tools.ts`, **875 LOC**) has 37 tools but
~77% capability parity with what an admin can do in the system. Two concrete defects:

1. **Asymmetric READ/WRITE** — agent can *mutate* qualification criteria, agency config, lead persona
   but cannot *read* them. Reproduced live: telling the assistant "add a criterion, keep the existing
   ones" called `update_criteria` (replace-semantics) with only the new criterion → **wiped all 5
   existing criteria**. Root cause: `update_criteria` replaces the whole array AND there is no tool to
   read current criteria first.
2. **Missing capabilities** — no lead deletion, no draft promotion, no persona write, no listing-image
   set, no Telegram link-token issuance / status / topic cleanup.

**Goal (user-approved):** full admin co-pilot — agent can do everything an admin can, including
destructive actions (delete lead, mass broadcast). Fix the asymmetry, add additive criteria ops, and
split the monolithic file into per-domain modules (project rule: code files < 200 LOC).

## 2. Approach (chosen: B — modularize + barrel)

Split `main-assistant-tools.ts` into per-domain modules under `lib/agent/tools/main-assistant/`:

```
lib/agent/tools/main-assistant/
├── index.ts        # buildMainAssistantTools — merges all module builders (the only public export)
├── leads.ts        # query/search/detail/update/delete lead, persona, qualification, memory
├── messaging.ts    # send_reply, draft_reply, promote_draft, get_draft, take_over, release, get_conversation_messages, search_messages, trigger_lead_turn
├── listings.ts     # list/create/update/delete/bulk_import, set_listing_image, listing_performance
├── viewings.ts     # list/get_detail/book/cancel/reschedule, list_available_slots
├── config.ts       # get_config, update_config, criteria (get/update/add/remove), handoff rules CRUD
├── telegram.ts     # telegram_broadcast, get_telegram_status, issue_telegram_link_token, close_lead_telegram_topics
├── analytics.ts    # pipeline_summary, weekly_report
└── subagents.ts    # trigger_operator_briefing, bulk_follow_up, notify_admin
```

Each module exports a builder `buildXTools(ctx, adminId, adminName, runAgentTurn)` returning its tool
slice. `index.ts` spreads them into one object. Signature of `buildMainAssistantTools` is unchanged →
callers (`run.ts`) need no change. Each module targets < 200 LOC.

Rejected: (A) keep one file — would grow to ~1100 LOC; (C) minimal fix — conflicts with full-parity goal.

## 3. New / changed tools

### 3.1 Visibility (READ) — new

| Tool | Input | Returns | Backing helper |
|---|---|---|---|
| `get_config` | `{}` | name, tone, `qualification_criteria`, calendar_id, agency_id | `ctx.config` (already in memory) |
| `get_telegram_status` | `{}` | group linked?, `telegram_group_chat_id`, `telegram_master_topic_id`, # leads with `telegram_user_id` | `getAgencyById` + `listLeads` filter |
| `get_viewing_detail` | `{ viewing_id }` | full viewing row (slot, status, contact, calendar_event_id, listing_id, lead_id) | `getViewingById` (tenant-guard agency_id) |
| `get_conversation_messages` | `{ conversation_id, limit? }` | visible messages of any thread | `getVisibleMessages` |
| `get_draft` | `{ lead_id }` | latest draft message (id, content) for lead's conversation, or null | `getConversationByLeadId` + `getLatestDraft` |

Enrich existing `get_lead_detail` to also return `persona`.

### 3.2 Action (WRITE) — new

| Tool | Input | Behavior | Backing helper |
|---|---|---|---|
| `add_criterion` | `{ key, label, hint? }` | **Additive**: read current criteria, append (reject dup key), persist via `updateCriteria`. Fixes data-loss bug. | `updateCriteria` |
| `remove_criterion` | `{ key }` | **Additive**: filter out key, persist. Error if not found or would leave 0. | `updateCriteria` |
| `update_lead_persona` | `{ lead_id, persona }` | Set lead.persona | `updateLead` |
| `delete_lead` | `{ lead_id, confirm: true }` | **Destructive**: hard-delete lead (tenant-guard). Requires `confirm:true`. Best-effort `closeLeadTopics` first. | `deleteLead` |
| `promote_draft` | `{ lead_id, content? }` | Send the lead's latest draft (optional edited content); dispatch + broadcast | `getLatestDraft` + `promoteDraftToSent` + `dispatchReply` |
| `set_listing_image` | `{ listing_id, image_url }` | Set listing.image_url (tenant-guard) | `updateListing` |
| `issue_telegram_link_token` | `{}` | Issue agency link token + `/link <token>` command + setup instructions | `issueAgencyTelegramLinkToken` (lib/auth) |
| `close_lead_telegram_topics` | `{ lead_id }` | Close the lead's Telegram forum topics | `closeLeadTopics` |

`update_criteria` (replace-all) is **kept** for full-list replacement; its description updated to warn
it replaces everything and to point at `add_criterion`/`remove_criterion` for incremental edits.

### 3.3 Out of scope (YAGNI)

Manual admin/lead Telegram binding, reading `admin_sessions`/`lead_magic_links` (internal auth),
handoff-rule test harness, lead merge/dedupe.

## 4. Prompt changes

`lib/agent/prompts/main-assistant-prompt.ts`:
- Add guidance: prefer `get_config` before editing config/criteria; verify current state first.
- Document criteria semantics: `update_criteria` = REPLACE ALL; use `add_criterion`/`remove_criterion`
  for incremental changes.
- Note destructive tools (`delete_lead`) require `confirm:true` and should be used only on explicit
  admin instruction.

## 5. Safety & guardrails

- All entity-scoped tools keep the existing tenant guard (`agency_id === ctx.config.agency_id`).
- `delete_lead` requires explicit `confirm:true` arg; agent must restate intent before calling.
- Reuse existing `broadcastAgencyDataChanged` / `broadcastConversationUpdate` after mutations so the
  admin UI stays live.
- No new third-party deps.

## 6. Testing

- Extend the existing LLM contract/eval harness with cases: read criteria → add criterion preserves
  existing; remove criterion; persona round-trip; delete_lead requires confirm; promote_draft sends.
- Type-level: `npm run typecheck` + `npm run build` must stay green.
- Manual smoke via `/api/admin/assistant` (login `admin@gmail.com`) mirroring the live test already run.

## 7. Migration / compatibility

- Pure additive at the API boundary: `buildMainAssistantTools` signature unchanged; `run.ts` untouched.
- No DB schema change (all backing columns/helpers already exist: `leads.persona`,
  `agencies.telegram_group_chat_id/telegram_master_topic_id`, `getLatestDraft`, `promoteDraftToSent`,
  `closeLeadTopics`, `deleteLead`, `issueAgencyTelegramLinkToken`).

## 8. Unresolved questions

1. `set_listing_image` takes a URL only — agent cannot upload binary. Acceptable? (UI keeps multipart
   upload for files.)
2. Should `delete_lead` cascade-delete conversations/messages/viewings, or does `deleteLead` already
   handle cascade? (Verify FK `onDelete` during implementation.)
3. Keep `update_criteria` (replace) long-term, or deprecate once add/remove proven? (Kept for now.)
