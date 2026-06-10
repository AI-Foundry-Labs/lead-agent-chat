# Main Assistant Agent — Design Spec

**Date:** 2026-06-08  
**Status:** Approved

## Overview

Add a `main_assistant` agent — a system-wide super-admin agent with full visibility and control over leads, listings, calendar, and subagents. Accessible via a new "Assistant" tab in the admin UI and as the primary Telegram bot for admins (replaces `admin_assistant` on Telegram).

Existing agents (`lead`, `lead_steward`, `anonymous_steward`, `admin_assistant`) remain unchanged as subagents.

---

## Architecture

```
Admin (web "Assistant" tab)  |  Admin (Telegram bot)
           │                              │
           ▼                              ▼
 /api/admin/assistant          handleAdminMessage()
           │                              │
           └──────────────┬───────────────┘
                          ▼
         runAgentTurn(conv.id, msg, { type: 'main_assistant' })
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
    system prompt      tools         messages
  buildMainAssistant  buildMain     getVisibleMessages
  SystemPrompt()      AssistantTools()
```

---

## DB Changes

- `lib/types.ts`: add `'main_assistant'` to `ConversationType`
- `lib/db/schema.ts`: update comment on `type` column
- `lib/db/conversations.ts`: add `getOrCreateMainAssistant(adminId)` function

No schema migration needed — `type` column is `varchar(24)`, no DB enum constraint.

---

## System Prompt

File: `lib/agent/prompts/main-assistant-prompt.ts`

Sections injected each turn:
1. `[ROLE]` — full system authority, acts on behalf of admin
2. `[SYSTEM SNAPSHOT]` — live counts: leads by status/potential, listings, pending viewings, manual-mode conversations
3. `[SUBAGENTS]` — when and how to trigger steward/lead agent
4. `[TOOLS]` — guidance on which tool to use for which intent
5. `[TONE]` — concise, professional, mirrors admin's language

---

## Tools

File: `lib/agent/tools/main-assistant-tools.ts`

### Lead Management
| Tool | Description |
|------|-------------|
| `query_leads` | List/filter leads by status, potential, listing |
| `get_lead_detail` | Full profile + conversation + messages |
| `send_reply` | Send message to lead immediately via dispatchReply |
| `draft_reply` | Compose draft (not sent) |
| `take_over` | Switch conversation to manual mode |
| `release_conversation` | Return conversation to agent mode |

### Listing Management
| Tool | Description |
|------|-------------|
| `list_listings` | List all active listings |
| `create_listing` | Create new listing |
| `update_listing` | Update price, title, description, rooms, surface |

### Calendar
| Tool | Description |
|------|-------------|
| `list_viewings` | All booked viewings across all leads |
| `cancel_viewing` | Cancel viewing + delete calendar event |
| `reschedule_viewing` | Move to new slot |

### Analytics
| Tool | Description |
|------|-------------|
| `pipeline_summary` | Leads by status/potential, conversion rates |
| `weekly_report` | Last 7 days: new leads, bookings, handoffs |

### Subagent Triggers
| Tool | Description |
|------|-------------|
| `trigger_steward_briefing(lead_id)` | Run lead_steward agent, return briefing text |
| `trigger_lead_turn(conversation_id, message)` | Inject message + run lead agent turn |

**Constraint:** Max 1 subagent trigger per main_assistant turn to avoid loops.

### System
| Tool | Description |
|------|-------------|
| `notify_admin` | Send Telegram notification |

---

## API Endpoint

File: `app/api/admin/assistant/route.ts`

- `GET` — load or create `main_assistant` conversation, return messages
- `POST { message }` — run agent turn, return updated messages

Pattern identical to `/api/admin/chat/route.ts`.

---

## UI

File: `components/admin/assistant-panel.tsx`

- New tab `'assistant'` in `AdminShell` — positioned last
- Label from i18n key `t.tab_assistant`
- Component reuses `ChatShell`, `ChatBubble`, `ChatComposer`, `ChatTypingIndicator`
- Header action: "Link Telegram" button (same flow as AgentsPanel)
- No data dependency on `AdminData` — fetches its own conversation via `/api/admin/assistant`

---

## Telegram Routing

File: `lib/telegram/handle-lead-telegram-update.ts`

`handleAdminMessage()` change:
```ts
// Before
const conv = await getOrCreateAdminAssistant(admin.id);
// After
const conv = await getOrCreateMainAssistant(admin.id);
```

Actor passed to `runAgentTurn`: `{ type: 'main_assistant', adminId, adminName }`.

---

## Files Changed

| Action | File |
|--------|------|
| Create | `lib/agent/tools/main-assistant-tools.ts` |
| Create | `lib/agent/prompts/main-assistant-prompt.ts` |
| Create | `components/admin/assistant-panel.tsx` |
| Create | `app/api/admin/assistant/route.ts` |
| Edit | `lib/types.ts` — add `'main_assistant'` to ConversationType |
| Edit | `lib/agent/run.ts` — add main_assistant actor branch |
| Edit | `lib/db/conversations.ts` — add `getOrCreateMainAssistant()` |
| Edit | `lib/telegram/handle-lead-telegram-update.ts` — route admin to main_assistant |
| Edit | `components/admin/admin-shell.tsx` — add assistant tab |
| Edit | `lib/i18n/*.ts` — add `tab_assistant` key |

---

## Out of Scope

- Auth/permission per tool (admin is single-user for now)
- Streaming responses (consistent with existing chat panels)
- Message history truncation (follows existing `getVisibleMessages` pattern)
