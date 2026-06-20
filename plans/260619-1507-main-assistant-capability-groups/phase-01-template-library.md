# Phase 01 — Message template library (F4b)

## Context Links
- Overview: [plan.md](plan.md) · Foundations: [phase-00](phase-00-foundations-shared.md)
- Pattern reference: `lib/agent/tools/main-assistant/leads.ts`, `messaging.ts`
- Lead fields for placeholders: `lib/db/schema.ts` (leads), `lib/agent/tools/main-assistant/leads.ts`

## Overview
- **Priority:** P2 · **Status:** pending · **Risk:** Low
- Reusable, agency-scoped message templates main_assistant can list / fill / insert. Pure CRUD + a
  render path. No new infra. Cheapest feature → first.

## Key Insights
- Templates are agency-owned config (like `agency_config`), not per-lead.
- Placeholder fill should reuse lead data already loaded by `getLeadById` — no new query path.
- Rendering only FILLS text; it does NOT send. Sending stays the job of existing `send_reply` /
  `draft_reply`. Keeps DRY: render → pass result to send tool (agent chains them).

## Requirements
**Functional:**
- CRUD: create / list / update / delete templates (title, body, agency_id).
- Render: `render_template(template_id, lead_id?)` → fills `{{placeholder}}` tokens from lead data.
- Unknown placeholder → left as-is OR returns list of unresolved tokens (decide, OQ-01-2).
**Non-functional:** agency-scoped; body length cap (e.g. 4000); placeholder syntax fixed `{{key}}`.

## Architecture
- Placeholder syntax: `{{name}}`, `{{email}}`, `{{listing_title}}`, `{{agency_name}}` (whitelist).
- Render = simple regex replace over a whitelist map built from lead + listing + agency config.
  No arbitrary expression eval (security + KISS).
- Data flow: `render_template` → load template (assert agency) → if lead_id, load lead + listing →
  build token map → regex replace → return `{ rendered, unresolved: string[] }`.

## Related Code Files
**Create:**
- `lib/db/schema.ts` addition: `message_templates` table — `id, agency_id, title, body, created_at, updated_at`.
- `lib/db/message-templates.ts` — CRUD helpers (~80 LOC).
- `lib/agent/tools/main-assistant/templates.ts` — `buildTemplatesTools(ctx)` (~120 LOC).
- `lib/agent/templates/render-template.ts` — pure render fn + token whitelist (~60 LOC).

**Modify:**
- `lib/db/client.ts`, `lib/db/index.ts` — export table + helpers.
- `lib/agent/tools/main-assistant/index.ts` — register `buildTemplatesTools`.
- `lib/agent/prompts/main-assistant-prompt.ts` — note: list/render templates before composing.

## Implementation Steps
1. Add `message_templates` table; migrate.
2. Write CRUD helpers in `lib/db/message-templates.ts`.
3. Write `render-template.ts` pure fn + token whitelist (name/email/listing_title/agency_name).
4. Build tools: `list_templates`, `get_template`, `create_template`, `update_template`,
   `delete_template`, `render_template`.
5. Register in barrel; append prompt note.
6. `npm run typecheck` + `npm run build`.

## Todo List
- [ ] message_templates table + migrate
- [ ] CRUD helpers
- [ ] render-template pure fn + whitelist
- [ ] 6 tools + Zod schemas
- [ ] register in barrel + prompt note
- [ ] typecheck/build green

## Success Criteria
- Agent can create a template, list it, render it filled with a lead's name, then pass result to
  `send_reply`. Unresolved tokens reported. All scoped to agency.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Placeholder injection / arbitrary eval | Low×Med | Whitelist tokens only; plain regex replace, no eval |
| Cross-agency template access | Low×Med | Every helper filters by `ctx.config.agency_id` |

## Security / GDPR Considerations
- Rendering reads lead PII into a message — Phase 04 audit applies to the SEND, not render.

## Next Steps
- Independent; no downstream dependency.

## OPEN QUESTIONS
- **OQ-01-1:** Which lead fields are allowed as placeholders? Proposed: name, email, listing_title,
  agency_name. Add budget/qual values?
- **OQ-01-2:** Unresolved placeholder behavior — leave `{{x}}` literal, blank it, or refuse render?
  Proposed: leave literal + return `unresolved[]`.
- **OQ-01-3:** Templates per-language (fr/en) needed, or single body? Proposed: single body (YAGNI).
