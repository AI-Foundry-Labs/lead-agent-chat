# Phase 02 Implementation Report — Agency Telegram Group Linking

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `lib/db/agency-telegram-links.ts` | 44 | Token CRUD + `bindTelegramGroupToAgency` |
| `lib/telegram/verify-agency-group.ts` | 82 | Supergroup + is_forum + bot can_manage_topics assertions |
| `lib/telegram/resolve-agency-admin.ts` | 40 | `resolveAgencyAdmin(telegramUserId, agencyId)` → admin row or null |

## Files Modified

| File | Change |
|------|--------|
| `lib/db/schema.ts` | Added `agency_telegram_link_tokens` table (token_hash PK, agency_id FK→agencies cascade, expires_at, consumed_at, created_at) |
| `lib/db/client.ts` | Exported `agency_telegram_link_tokens` |
| `lib/db/index.ts` | Re-exported table + `* from ./agency-telegram-links` |
| `lib/auth.ts` | Added `issueAgencyTelegramLinkToken(agencyId)` + `consumeAgencyTelegramLink(token)` with 10-min TTL; imported new DB helpers |
| `app/api/admin/link-telegram/route.ts` | Switched from per-admin `issueTelegramLinkToken` to `issueAgencyTelegramLinkToken(admin.agency_id)`; returns `/link <token>` + bilingual setup instructions; removed deep-link (group flow requires pasting in group) |
| `lib/telegram.ts` | Added `getChatMember(chatId, userId)` + `getChat(chatId)` wrappers using grammY bot.api |
| `lib/telegram-router-types.ts` | Extended `TelegramUpdate.message.chat` with `type?: string` + `is_forum?: boolean` |
| `lib/telegram/handle-lead-telegram-update.ts` | Added GROUP branch: `/link <token>` → `handleAgencyGroupLink`; registered-group guard (unregistered groups → ignore); private flows unchanged; return type extended to include `'group'` |
| `app/api/telegram/route.ts` | Replaced `!==` secret compare with `crypto.timingSafeEqual` + length guard |

## Link Flow

```
admin (web) POST /api/admin/link-telegram
  → requireAdmin() → admin.agency_id
  → issueAgencyTelegramLinkToken(agency_id)  [sha256, 10-min, single-use]
  → returns { token, command: "/link <token>", instructions[], configured }

admin pastes "/link <token>" IN the Telegram supergroup
  → webhook POST /api/telegram/route.ts
      timingSafeEqual(secret) check
  → handleTelegramUpdate()
      chatType = 'supergroup' → GROUP branch
      text.startsWith('/link ') → handleAgencyGroupLink(chat, token)
        consumeAgencyTelegramLink(token) → agencyId (or null → error reply)
        getBotId() → bot numeric id (cached via getMe())
        verifyAgencyGroup(chat, botId)
          getChat(chatId) → assert is_forum
          getChatMember(chatId, botId) → assert admin + can_manage_topics
          → { ok: true } or { ok: false, reason: "FR\nEN" }
        if !ok → sendTelegramMessage(chatId, reason)
        else → bindTelegramGroupToAgency(agencyId, chatId)
               sendTelegramMessage(chatId, "✅ success + next steps")
```

## Security Choices

- **Agency-scoped token**: issued using `admin.agency_id` from `requireAdmin()` — an admin can only issue tokens for their own agency.
- **No sender-identity gate at bind time**: phase spec says DO NOT hard-block on `resolveAgencyAdmin` for the group-link step (admins may not have `telegram_user_id` set). The consumed token already proves the linker is an authenticated admin of the agency.
- **timingSafeEqual**: webhook secret compare uses constant-time comparison with a length pre-check (same-length Buffers required by Node).
- **Registered-group guard**: any group message whose `chat.id` is not in `agencies.telegram_group_chat_id` → ignored immediately (no processing, no crash).
- **Re-link safety**: `bindTelegramGroupToAgency` is a plain `UPDATE`; re-linking another group replaces the binding idempotently.

## Test Results

- `npm run typecheck` → clean (0 errors)
- `npm run test` → 40/40 pass
- `npm run test:agent` → 226/226 pass

## Unresolved Questions

1. **`getChat` vs update payload `is_forum`**: Telegram update messages for supergroups do include `is_forum` in the `Chat` object when topics are enabled, but the field is not always present in partial update shapes. We fetch via `getChat()` to be certain — one extra API call per `/link` command. Acceptable for a rare setup operation.
2. **Bot ID caching**: `cachedBotId` is module-level; in serverless/edge runtimes it resets per cold start. For a rarely-called setup command this is fine, but Phase 04 (which may call getChatMember per message) should use a shared cache or store bot id in env.
3. **`handleAgencyGroupLink` chat type parameter**: the function parameter is typed as `NonNullable<TelegramUpdate['message']>['chat'] & object` then cast to `Record<string, unknown>` for `verifyAgencyGroup`. Slightly awkward; Phase 04 may want to tighten `TelegramUpdate` to a proper discriminated union.

---

**Status:** DONE
**Summary:** All 8 deliverables implemented. Typecheck clean. Unit (40) + agent (226) tests green. Lead-DM flow and admin /start flow untouched.
**Concerns:** None blocking. See unresolved questions above for minor follow-ups.
