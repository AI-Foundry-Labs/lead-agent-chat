# Phase 02 — Agency Telegram Group Linking

## Overview
- **Priority:** Critical
- **Status:** completed
- **Description:** Replace per-admin DM linking with **per-agency group** linking. An admin links the agency's Telegram supergroup (forum) once; the bot binds the group to the agency.

## Key Insights
- Current admin linking binds `admins.telegram_user_id` to a private chat (see review: it even binds `chatId` not `fromId`). New flow binds at agency level → that bug becomes moot for agency linking.
- Telegram has **no API to create bots or groups**; agency owner creates the supergroup, enables Topics, adds + promotes the bot manually. We provide a guided flow + a "verify connection" check.
- Bot-as-group-admin receives **all** group messages (privacy mode bypass) — required for topic routing in Phase 04.

## Requirements
**Functional**
- `POST /api/admin/link-telegram` issues a single-use token scoped to the admin's `agency_id` (not admin id).
- Admin sends `/link <token>` **inside the agency group**; bot reads `chat.id` (the group), verifies it's a supergroup with topics enabled, and sets `agencies.telegram_group_chat_id`.
- Bot verifies it has *Manage Topics* admin right; if not, replies with setup instructions.
- "Verify connection" endpoint/UI confirms group bound + bot rights OK.

**Non-functional**
- Reuse existing token table mechanics (hashed, single-use, short TTL).

## Architecture
```
admin (web) → POST /api/admin/link-telegram
   → issueAgencyTelegramLinkToken(agency_id)  [sha256, 10-min TTL, single-use]
   → returns /link <token>  (NOT a t.me/start deep link — must be sent in the group)

agency owner in GROUP sends: /link <token>
   webhook → handleAgencyGroupLink(chat, token)
     · consume token → agency_id
     · assert chat.type === 'supergroup' && chat.is_forum
     · getChatMember(bot) → assert can_manage_topics
     · agencies.telegram_group_chat_id = chat.id
     · reply ✅ + create the "General/handoff" baseline
```

## Related Code Files
**Modify**
- `lib/db/schema.ts` — new `agency_telegram_link_tokens` (token_hash, agency_id, expires_at, consumed_at). (Keep admin token table for the untouched lead-DM flow.)
- `lib/auth.ts` — `issueAgencyTelegramLinkToken` / `consumeAgencyTelegramLink`.
- `app/api/admin/link-telegram/route.ts` — issue agency-scoped token; return `/link <token>` + group setup hint.
- `lib/telegram/handle-lead-telegram-update.ts` — add `handleAgencyGroupLink`; branch when `chat.type` is `supergroup`/`group` and text starts with `/link`.
- `lib/telegram.ts` — add `getChatMember` / topic-permission check helper if missing.

**Create**
- `lib/db/agency-telegram-links.ts` — token CRUD + `bindTelegramGroupToAgency`.
- `lib/telegram/verify-agency-group.ts` — supergroup + forum + bot-rights assertions.
- `lib/telegram/resolve-agency-admin.ts` — **`resolveAgencyAdmin(telegramUserId, agencyId)`** (red-team C2). Maps a Telegram group sender to an `admins` row of that agency via `admins.telegram_user_id`. Returns null if unmapped.

## Sender→admin mapping (red-team C2 — blocks Topic 2 / takeover)
`operator` turns and takeover require a real `adminId`; a Telegram group `from.id` is not one. So:
- Keep `admins.telegram_user_id` (an agency admin links their personal Telegram once, so the bot can attribute their group actions). This is separate from the agency *group* binding in this phase.
- Add a lightweight `/iam <token>` (or reuse existing admin link) so each admin self-identifies their Telegram user id within the agency.
- Group sender **unmapped → reject with hint** ("Identifiez-vous d'abord"), never silent-fallback to another admin.

## Registered-group guard (red-team I4)
Webhook MUST reject any group update whose `chat.id ∉ agencies.telegram_group_chat_id`. Prevents a stranger adding the bot to a random group and probing.

## Implementation Steps
1. Add `agency_telegram_link_tokens` table + helpers.
2. `issueAgencyTelegramLinkToken(agencyId)` in `lib/auth.ts` (mirror existing token pattern).
3. Update `POST /api/admin/link-telegram` to use admin's `agency_id`; return `/link` command + instructions (not `/start`).
4. In webhook handler, detect group context (`chat.type !== 'private'`) and `/link <token>` → `handleAgencyGroupLink`.
5. Verify supergroup + forum + bot `can_manage_topics`; on failure reply with exact setup steps.
6. Set `agencies.telegram_group_chat_id`; reply success; create baseline General topic record (Phase 03 owns topic creation helper).
7. Add "verify connection" path for the admin UI.

## Todo List
- [x] `agency_telegram_link_tokens` table + helpers
- [x] `issueAgencyTelegramLinkToken` / `consumeAgencyTelegramLink`
- [x] Update link-telegram route to agency scope + `/link` command
- [x] Group-context branch in webhook + `handleAgencyGroupLink`
- [x] Supergroup/forum/bot-rights verification
- [x] Bind group to agency + success reply
- [x] Verify-connection path

## Success Criteria
- Sending `/link <token>` in a properly configured group binds it to the agency; wrong setup yields actionable error.
- `agencies.telegram_group_chat_id` populated; re-linking another group updates it safely.

## Risk Assessment
- **Medium:** group not a forum / bot lacks rights → topics fail later. Mitigation: hard-verify at link time, refuse to bind otherwise.
- **Low:** token reuse across agencies — prevented by single-use + agency-scoped token.

## Security Considerations
- Token must be agency-scoped and issued only to authenticated admin of that agency (`requireAdmin` → `agency_id`).
- Constant-time secret compare in webhook (carry over hardening from review).
- Only bind if the linker is recognized; consider requiring the issuing admin to be the sender (match `from.id` to a known admin of that agency) to prevent a leaked `/link` token binding an attacker's group.

## Next Steps
- Phase 03 creates per-lead topics inside the bound group.
