# Documentation Update: Telegram Auto Master Agent

**Status:** DONE

## Summary
Updated project documentation to reflect Telegram auto master agent feature: auto-bind on bot promotion via `my_chat_member`, single 🛠 Master topic per agency, removal of per-lead topics, proactive notification push, and `/link` fallback.

## Files Changed

### 1. `docs/codebase-summary.md`
- **Removed:** Per-lead topic references (`route-group-message.ts`, `lead-topics.ts` per-lead logic)
- **Updated Telegram module list:**
  - Added `bind-agency-group.ts` (auto-bind on bot promotion + Master topic creation)
  - Renamed/clarified routing handlers (removed route-group-message → added handle-group-telegram-message, handle-agent-callback)
  - Updated dispatch flow: `my_chat_member` and `callback_query` handling
- **Schema changes:**
  - Added `telegram_master_topic_id INT` field to agencies table
  - Replaced per-lead topic table entry with note that per-lead topics are removed
- **Multi-Tenant Files table:** Updated to reference `bind-agency-group.ts` instead of per-lead topic logic

### 2. `docs/dev-guide.md`
- **6.4 Link group:** Clarified two flows:
  - **Option A (Auto-bind):** Bot detects promotion, resolves agency via promoter, auto-binds + creates Master topic
  - **Option B (Fallback):** `/link <token>` when promoter not linked at web
- **6.5 Topics:** Simplified table—removed per-lead topic rows; Master topic now auto-created on promotion/link
- **6.6 Master topic:** Updated handler reference from `handleMasterTopicMessage` to `handleGroupTelegramMessage`; listed slash commands (`/leads`, `/lead_history`, `/agent`, `/pool`, `/help`)
- **6.7 Handoff:** Changed notification flow to "push proactive" into Master topic (was inline into per-lead topics)
- **File references table:** Updated to point to bind-agency-group, removed per-lead topic file, clarified main-assistant tool location

### 3. `docs/agency-user-guide.md`
- **5.2 Liên kết nhóm:** Rewrote with two clear Vietnamese paths:
  - **Cách 1 (Auto-bind):** Promote bot when promoter already linked at web
  - **Cách 2 (Fallback):** `/link <mã>` from web if Cách 1 fails
- **5.3 Topics:** Removed distinction between per-lead 💬/🤖 topics; now only 🛠 Master exists
- **5.4 Rep khách:** Simplified to:
  - **Cách A (Web):** Recommend tab Conversations (mirror to Master)
  - **Cách B (Telegram):** Send commands to Master topic (`/lead_history`, natural language)
- **7 Sự cố:** Removed per-lead topic troubleshooting; updated Master topic error to include auto-bind flow

## Verification Notes
- Confirmed `lib/telegram/bind-agency-group.ts` exists and implements shared logic for my_chat_member + /link fallback
- Verified `telegram_master_topic_id` field in agencies schema
- Checked webhook `allowed_updates` includes `['message', 'callback_query', 'my_chat_member']`
- Confirmed per-lead files not referenced (route-group-message, report-turn-to-topic deleted)
- Verified new handle-group-telegram-message and handle-agent-callback files exist

## Unresolved Questions
- None — all feature changes verified against actual codebase.

