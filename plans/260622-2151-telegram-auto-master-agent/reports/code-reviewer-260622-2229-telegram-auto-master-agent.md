# Code Review — Telegram Auto Master Agent

Date: 2026-06-22 | Reviewer: code-reviewer | Branch: develop (uncommitted)

## Scope
- 18 changed files, +84/-533 LOC (net deletion — good, removes per-lead topic complexity)
- New: `lib/telegram/bind-agency-group.ts`, `eval_harness/unit/telegram-bot-promotion-guard.test.ts`
- Focus: auto-bind security, idempotency, dead-code, silent fan-out

## Overall Assessment
Solid, well-reasoned change. The shared `bindAgencyGroupAndEnsureMaster` helper
correctly DRYs the `/link` and auto-bind paths. Guard logic is pure + unit-tested.
No blocking security holes. A few correctness/robustness items below.

## Critical Issues
None.

## High Priority

### H1. Master-topic creation is a check-then-act race (TOCTOU)
`bind-agency-group.ts:48-52` — reads `agency.telegram_master_topic_id === null`,
then `createForumTopic` + `setAgencyMasterTopic`. `my_chat_member` can fire
concurrently (e.g. promote + rights edit in quick succession, or webhook retry
hitting two server instances). Two concurrent passes both see `null` → two
forum topics created, second `setAgencyMasterTopic` wins, first topic orphaned.
- Impact: low frequency, cosmetic (orphan "🛠 Master" topic + duplicate welcome
  msg), not data loss. The `markSeen` idempotency guard does NOT cover the
  `my_chat_member` branch (it returns at line 107, before markSeen at 164).
- Fix options: (a) make `setAgencyMasterTopic` conditional —
  `WHERE telegram_master_topic_id IS NULL ... RETURNING`, create the topic only
  if the update affected a row; or (b) apply `markSeen(update_id)` to the
  my_chat_member branch too. (a) is the robust fix since it also covers
  multi-instance. Recommend (a).

## Medium Priority

### M1. Auto-bind trusts the promoter's agency, not group ownership
`handleBotPromotedToAdmin:139-153` — agency resolved purely via
`from.id → getAdminByTelegramUserId → agency_id`. Any linked admin of ANY agency
who promotes the bot in ANY supergroup binds that group to their agency. Telegram
requires admin rights to promote, which is the only gate. Given groups are
agency-private and `telegram_group_chat_id` is `UNIQUE` (one group ↔ one agency,
cannot silently steal another agency's already-bound group — the existing-binding
short-circuit at line 127 runs first), the residual risk is a linked admin
binding a *new* group to their own agency. That is benign. No fix required, but
worth a one-line comment noting the trust assumption. Already captured in agent memory.

### M2. `getBotId()` failure silently downgrades bot-rights verification
If `getBot()` throws/returns no id, `getBotId()` returns `undefined`, and
`verifyAgencyGroup` (line 46) *skips* the `can_manage_topics` admin-rights check
entirely, binding the group + attempting `createForumTopic` which will then fail
and log a warning (master topic not created). Net: group bound but no Master
topic, no clear user-facing error. Acceptable degradation, but consider posting
the verifyAgencyGroup failure message when botUserId can't be resolved, so the
admin knows to retry rather than getting a half-bound group.

### M3. `from.is_bot` not checked in promotion path
`my_chat_member.from` could in theory be another bot promoting this bot.
`getAdminByTelegramUserId` would just return null → harmless "not linked"
message. Low risk; no action needed, noting for completeness.

## Low Priority

### L1. Dead-code no-ops (as flagged by author) — agree with keeping
`getOrCreateLeadTopics` returns null when `!telegram_topics_enabled`
(lead-topics.ts:86), and `bindTelegramGroupToAgency` always sets
`telegram_topics_enabled=false`. Verified the guard is real, so
`getOrCreateLeadTopics`/`syncLeadTopicTitles`/`mirrorLeadTurnToTopic`/
`closeLeadTopics` are genuinely inert. Agree: removing cascades into 5+ tool
files for no behavior change → YAGNI says leave them. Suggest a single tracking
note in the plan to delete in a dedicated cleanup PR so they don't rot silently.

### L2. `knownMessages` param kept for call-site compat but unused
`promote-anonymous-visitor.ts` — documented, harmless. Fine for now; drop in the
same future cleanup as L1.

### L3. notify-agency hardcodes slash-command hints in the fallback text
When `telegram_master_topic_id` is null the alert still tells admins to use
`/lead_history` / `/agent`, but it lands in General. Those commands DO route to
the master assistant now (every thread routes there per the dispatcher change),
so this is correct — just confirming it's intentional. No action.

## Edge Cases Checked
- Re-fire of `my_chat_member` on already-bound group → short-circuits via
  `getAgencyByTelegramGroup` existing-check (line 127), only ensures Master topic. OK
  (modulo H1 race).
- Demotion / admin→admin / non-supergroup → filtered by `isBotPromotionToAdmin`,
  well covered by the new unit test (6 cases incl. left→admin, plain member).
- Fan-out extras (`silent`) skip auto-bind (line 106) → only primary binds,
  prevents double Master-topic across instances. Correct *within a single
  instance*; H1 still applies across separate instances if both receive the
  primary (non-silent) update.
- Webhook auth: unchanged, timing-safe secret compare. Good.
- `getAgencyByTelegramGroup` uses unique column → no ambiguity. Good.

## Positive Observations
- Clean DRY refactor; pure guard extracted + unit-tested (testable boundary).
- Net −449 LOC, removes whole subsystems (route-group-message, report-turn-to-topic).
- Bilingual user-facing error messages preserved consistently.
- `my_chat_member` added to `allowed_updates` in BOTH set-webhook.ts and
  telegram-dev.ts — easy to forget, done correctly.
- Schema `UNIQUE` on `telegram_group_chat_id` is the load-bearing safety property
  and it's in place.

## Recommended Actions (priority order)
1. H1: make `setAgencyMasterTopic` conditional (`WHERE ... IS NULL RETURNING`)
   and only `createForumTopic` when a row was claimed — closes the duplicate-topic race.
2. M2: surface a user-facing error when `getBotId()` is unresolved instead of
   half-binding silently.
3. L1/L2: add a plan note to delete the inert lead-topic functions + unused param
   in a follow-up cleanup PR.

## Metrics
- Typecheck: passes (per author). Unit tests: pass (2 pre-existing unrelated failures confirmed on HEAD).
- Build: not run (blocked by hook) — UNVERIFIED.

## Unresolved Questions
1. Can two server instances both receive the *primary* (non-silent) webhook for
   the same `my_chat_member`? If yes, H1 fix (a) is required, not optional.
2. Was `build` ever green on this branch elsewhere (CI)? Could not run locally.
