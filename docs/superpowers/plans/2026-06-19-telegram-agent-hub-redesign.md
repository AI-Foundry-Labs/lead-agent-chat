# Telegram Agent Hub Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-lead Telegram topics with a single Master-topic hub where the admin picks a subagent via `/agent`, and route all lead notifications into that channel as operator-composed messages persisted to both the operator↔admin and main-assistant↔admin DB histories.

**Architecture:** A new `telegram_agent_sessions` table (one row per agency) records the active subagent (`main` or `operator:<leadId>`). The agency Master topic becomes the hub: `/agent` commands and inline-keyboard callbacks set the session; plain text dispatches to the active subagent via the existing `runAgentTurn`. A new `pushAgentNotification` helper composes notices with `generateStaffReport`, posts them to the Master topic, and dual-writes them into both conversation histories.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM + Postgres, raw Telegram Bot API (webhook update parsing), node:test (`node --require tsx/cjs --test`).

## Global Constraints

- One admin per agency — resolve the acting admin via `resolveActingAdmin(fromId, agencyId)` (returns the agency's admin); never disambiguate by message author.
- Active-session selection is scoped to the **whole agency** (single row in `telegram_agent_sessions` keyed by `agency_id`).
- All tenant lookups stay scoped by `agency_id`; `/agent lead <query>` only matches leads in the acting admin's agency.
- Code files < 200 LOC; kebab-case filenames; descriptive comments.
- Per-lead forum topics stay gated behind the existing `agencies.telegram_topics_enabled` flag (default `false`) — do NOT enable or remove them.
- Telegram send failures must never break a lead turn — wrap sends in try/catch; DB dual-write happens regardless of Telegram delivery.
- Unit tests live in `eval_harness/unit/*.test.ts` and use `node:test` (`describe`/`it`) + `node:assert/strict`. Run with `npm test`. Type check with `npm run typecheck`.

---

### Task 1: Active-session model — table, helpers, pure actor resolver

**Files:**
- Modify: `lib/db/schema.ts` (add `telegram_agent_sessions` table near the other telegram tables)
- Create: `lib/db/telegram-agent-sessions.ts`
- Modify: `lib/db/index.ts` (export the new table + helpers)
- Test: `eval_harness/unit/telegram-agent-session.test.ts`

**Interfaces:**
- Produces:
  - `type AgentSession = { agent_kind: 'main'; lead_id: null } | { agent_kind: 'operator'; lead_id: string }`
  - `type ActiveActor = { type: 'main_assistant' } | { type: 'operator'; leadId: string }`
  - `resolveActiveActor(session: AgentSession | null): ActiveActor | null`
  - `getAgentSession(agencyId: string): Promise<AgentSession | null>`
  - `setAgentSession(agencyId: string, session: AgentSession): Promise<void>`

- [ ] **Step 1: Write the failing test** (pure resolver only)

Create `eval_harness/unit/telegram-agent-session.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveActor } from '../../lib/db/telegram-agent-sessions';

describe('resolveActiveActor', () => {
  it('returns null when no session', () => {
    assert.equal(resolveActiveActor(null), null);
  });
  it('maps main session to main_assistant actor', () => {
    assert.deepEqual(resolveActiveActor({ agent_kind: 'main', lead_id: null }), {
      type: 'main_assistant'
    });
  });
  it('maps operator session to operator actor with leadId', () => {
    assert.deepEqual(
      resolveActiveActor({ agent_kind: 'operator', lead_id: 'lead-1' }),
      { type: 'operator', leadId: 'lead-1' }
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- 2>&1 | grep -A3 telegram-agent-session` (or `node --require tsx/cjs --test eval_harness/unit/telegram-agent-session.test.ts`)
Expected: FAIL — cannot find module `telegram-agent-sessions`.

- [ ] **Step 3: Add the schema table**

In `lib/db/schema.ts`, after the `telegram_link_tokens` table, add:

```ts
// ─── Telegram agent hub session (one active subagent per agency) ────────────
// agent_kind='main' → main-assistant; agent_kind='operator' → operator for lead_id.
export const telegram_agent_sessions = pgTable('telegram_agent_sessions', {
  agency_id: uuid('agency_id')
    .primaryKey()
    .references(() => agencies.id, { onDelete: 'cascade' }),
  agent_kind: varchar('agent_kind', { length: 20 }).notNull(), // 'main' | 'operator'
  lead_id: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});
```

- [ ] **Step 4: Create the helpers + pure resolver**

Create `lib/db/telegram-agent-sessions.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import { db } from './client';
import { telegram_agent_sessions } from './schema';

export type AgentSession =
  | { agent_kind: 'main'; lead_id: null }
  | { agent_kind: 'operator'; lead_id: string };

export type ActiveActor =
  | { type: 'main_assistant' }
  | { type: 'operator'; leadId: string };

/** Pure: map a stored session row to the actor runAgentTurn expects. */
export function resolveActiveActor(session: AgentSession | null): ActiveActor | null {
  if (!session) return null;
  if (session.agent_kind === 'operator' && session.lead_id) {
    return { type: 'operator', leadId: session.lead_id };
  }
  return { type: 'main_assistant' };
}

export async function getAgentSession(agencyId: string): Promise<AgentSession | null> {
  const [row] = await db
    .select()
    .from(telegram_agent_sessions)
    .where(eq(telegram_agent_sessions.agency_id, agencyId))
    .limit(1);
  if (!row) return null;
  return row.agent_kind === 'operator' && row.lead_id
    ? { agent_kind: 'operator', lead_id: row.lead_id }
    : { agent_kind: 'main', lead_id: null };
}

export async function setAgentSession(agencyId: string, session: AgentSession): Promise<void> {
  await db
    .insert(telegram_agent_sessions)
    .values({
      agency_id: agencyId,
      agent_kind: session.agent_kind,
      lead_id: session.lead_id,
      updated_at: new Date()
    })
    .onConflictDoUpdate({
      target: telegram_agent_sessions.agency_id,
      set: { agent_kind: session.agent_kind, lead_id: session.lead_id, updated_at: new Date() }
    });
}
```

Note: confirm the db client import path — match the existing pattern in `lib/db/conversations.ts` (it imports `db` from the same module the other helpers use). If they import from `./schema` re-export or a `./client`, mirror exactly.

- [ ] **Step 5: Export from the barrel**

In `lib/db/index.ts`: add `telegram_agent_sessions` to the schema re-export list (with the other telegram tables) and add `export * from './telegram-agent-sessions';` with the other helper re-exports.

- [ ] **Step 6: Run test + typecheck**

Run: `node --require tsx/cjs --test eval_harness/unit/telegram-agent-session.test.ts`
Expected: PASS (3 tests).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Push schema + commit**

Run: `npm run db:push` (creates `telegram_agent_sessions`). Expected: applies cleanly.

```bash
git add lib/db/schema.ts lib/db/telegram-agent-sessions.ts lib/db/index.ts eval_harness/unit/telegram-agent-session.test.ts
git commit -m "feat(telegram): add telegram_agent_sessions table + active-actor resolver"
```

---

### Task 2: `/agent` command + callback parsing (pure)

**Files:**
- Create: `lib/telegram/agent-command.ts`
- Test: `eval_harness/unit/agent-command-parse.test.ts`

**Interfaces:**
- Produces:
  - `type AgentCommand = { kind: 'show' } | { kind: 'set_main' } | { kind: 'set_lead'; query: string } | { kind: 'not_command' }`
  - `parseAgentCommand(text: string): AgentCommand`
  - `type AgentCallback = { kind: 'main' } | { kind: 'lead'; leadId: string } | null`
  - `parseAgentCallback(data: string): AgentCallback`

- [ ] **Step 1: Write the failing test**

Create `eval_harness/unit/agent-command-parse.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentCommand, parseAgentCallback } from '../../lib/telegram/agent-command';

describe('parseAgentCommand', () => {
  it('returns not_command for plain text', () => {
    assert.deepEqual(parseAgentCommand('hello there'), { kind: 'not_command' });
  });
  it('returns show for bare /agent', () => {
    assert.deepEqual(parseAgentCommand('/agent'), { kind: 'show' });
    assert.deepEqual(parseAgentCommand('  /agent  '), { kind: 'show' });
  });
  it('returns set_main for /agent main', () => {
    assert.deepEqual(parseAgentCommand('/agent main'), { kind: 'set_main' });
  });
  it('returns set_lead with trimmed query for /agent lead <q>', () => {
    assert.deepEqual(parseAgentCommand('/agent lead Marie Dupont'), {
      kind: 'set_lead',
      query: 'Marie Dupont'
    });
  });
  it('returns show for /agent lead with no query', () => {
    assert.deepEqual(parseAgentCommand('/agent lead'), { kind: 'show' });
  });
});

describe('parseAgentCallback', () => {
  it('parses agent:main', () => {
    assert.deepEqual(parseAgentCallback('agent:main'), { kind: 'main' });
  });
  it('parses agent:lead:<id>', () => {
    assert.deepEqual(parseAgentCallback('agent:lead:abc-123'), { kind: 'lead', leadId: 'abc-123' });
  });
  it('returns null for unrelated data', () => {
    assert.equal(parseAgentCallback('other:thing'), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --require tsx/cjs --test eval_harness/unit/agent-command-parse.test.ts`
Expected: FAIL — cannot find module `agent-command`.

- [ ] **Step 3: Implement the parsers**

Create `lib/telegram/agent-command.ts`:

```ts
// Pure parsing/rendering helpers for the Telegram /agent hub. No I/O here.

export type AgentCommand =
  | { kind: 'show' }
  | { kind: 'set_main' }
  | { kind: 'set_lead'; query: string }
  | { kind: 'not_command' };

export function parseAgentCommand(text: string): AgentCommand {
  const t = text.trim();
  if (t !== '/agent' && !t.startsWith('/agent ')) return { kind: 'not_command' };
  const rest = t.slice('/agent'.length).trim();
  if (rest === '') return { kind: 'show' };
  if (rest === 'main') return { kind: 'set_main' };
  if (rest === 'lead' || rest.startsWith('lead ')) {
    const query = rest.slice('lead'.length).trim();
    return query ? { kind: 'set_lead', query } : { kind: 'show' };
  }
  return { kind: 'show' };
}

export type AgentCallback = { kind: 'main' } | { kind: 'lead'; leadId: string } | null;

export function parseAgentCallback(data: string): AgentCallback {
  if (data === 'agent:main') return { kind: 'main' };
  const m = data.match(/^agent:lead:(.+)$/);
  if (m) return { kind: 'lead', leadId: m[1] };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --require tsx/cjs --test eval_harness/unit/agent-command-parse.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/agent-command.ts eval_harness/unit/agent-command-parse.test.ts
git commit -m "feat(telegram): parse /agent commands and inline-keyboard callbacks"
```

---

### Task 3: Keyboard + agent-label rendering (pure)

**Files:**
- Modify: `lib/telegram/agent-command.ts` (append builders)
- Test: `eval_harness/unit/agent-command-render.test.ts`

**Interfaces:**
- Consumes: `AgentSession` (Task 1)
- Produces:
  - `type LeadButton = { id: string; label: string }`
  - `buildAgentKeyboard(leads: LeadButton[], max?: number): { inline_keyboard: { text: string; callback_data: string }[][] }`
  - `formatAgentLabel(session: AgentSession | null, leadName?: string | null): string`

- [ ] **Step 1: Write the failing test**

Create `eval_harness/unit/agent-command-render.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentKeyboard, formatAgentLabel } from '../../lib/telegram/agent-command';

describe('buildAgentKeyboard', () => {
  it('always puts a Main button first', () => {
    const kb = buildAgentKeyboard([]);
    assert.deepEqual(kb.inline_keyboard[0], [{ text: '🤖 Main', callback_data: 'agent:main' }]);
  });
  it('adds one row per lead with agent:lead:<id> callback', () => {
    const kb = buildAgentKeyboard([{ id: 'l1', label: 'Marie' }]);
    assert.deepEqual(kb.inline_keyboard[1], [
      { text: '👤 Marie', callback_data: 'agent:lead:l1' }
    ]);
  });
  it('caps lead rows at max (default 8)', () => {
    const leads = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, label: `L${i}` }));
    const kb = buildAgentKeyboard(leads);
    // 1 Main row + 8 lead rows
    assert.equal(kb.inline_keyboard.length, 9);
  });
});

describe('formatAgentLabel', () => {
  it('labels null session as Main (default)', () => {
    assert.equal(formatAgentLabel(null), '🤖 Main');
  });
  it('labels main session', () => {
    assert.equal(formatAgentLabel({ agent_kind: 'main', lead_id: null }), '🤖 Main');
  });
  it('labels operator session with lead name', () => {
    assert.equal(
      formatAgentLabel({ agent_kind: 'operator', lead_id: 'l1' }, 'Marie'),
      '👤 Operator · Marie'
    );
  });
  it('falls back to "lead" when name missing', () => {
    assert.equal(
      formatAgentLabel({ agent_kind: 'operator', lead_id: 'l1' }, null),
      '👤 Operator · lead'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --require tsx/cjs --test eval_harness/unit/agent-command-render.test.ts`
Expected: FAIL — `buildAgentKeyboard` / `formatAgentLabel` not exported.

- [ ] **Step 3: Append the builders**

Append to `lib/telegram/agent-command.ts`:

```ts
import type { AgentSession } from '@/lib/db/telegram-agent-sessions';

export type LeadButton = { id: string; label: string };

export function buildAgentKeyboard(
  leads: LeadButton[],
  max = 8
): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows: { text: string; callback_data: string }[][] = [
    [{ text: '🤖 Main', callback_data: 'agent:main' }]
  ];
  for (const lead of leads.slice(0, max)) {
    rows.push([{ text: `👤 ${lead.label}`, callback_data: `agent:lead:${lead.id}` }]);
  }
  return { inline_keyboard: rows };
}

export function formatAgentLabel(session: AgentSession | null, leadName?: string | null): string {
  if (session?.agent_kind === 'operator') return `👤 Operator · ${leadName ?? 'lead'}`;
  return '🤖 Main';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --require tsx/cjs --test eval_harness/unit/agent-command-render.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/agent-command.ts eval_harness/unit/agent-command-render.test.ts
git commit -m "feat(telegram): /agent inline keyboard + agent label builders"
```

---

### Task 4: Notification dual-write targets (pure)

**Files:**
- Create: `lib/agent/push-agent-notification.ts` (pure helper only this task)
- Test: `eval_harness/unit/push-agent-notification-targets.test.ts`

**Interfaces:**
- Produces:
  - `type NotificationTarget = { conversation_id: string; role: 'assistant'; content: string }`
  - `buildNotificationTargets(operatorConvId: string, mainConvId: string, content: string): NotificationTarget[]`

- [ ] **Step 1: Write the failing test**

Create `eval_harness/unit/push-agent-notification-targets.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotificationTargets } from '../../lib/agent/push-agent-notification';

describe('buildNotificationTargets', () => {
  it('writes the same content to operator and main conversations', () => {
    const t = buildNotificationTargets('op-1', 'main-1', 'Handoff: price talk');
    assert.deepEqual(t, [
      { conversation_id: 'op-1', role: 'assistant', content: 'Handoff: price talk' },
      { conversation_id: 'main-1', role: 'assistant', content: 'Handoff: price talk' }
    ]);
  });
  it('omits duplicate when operator and main are the same conversation', () => {
    const t = buildNotificationTargets('same', 'same', 'x');
    assert.equal(t.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --require tsx/cjs --test eval_harness/unit/push-agent-notification-targets.test.ts`
Expected: FAIL — cannot find module `push-agent-notification`.

- [ ] **Step 3: Implement the pure helper**

Create `lib/agent/push-agent-notification.ts`:

```ts
// Notification = operator-composed report, sent to the Master topic and
// persisted to BOTH the operator↔admin and main-assistant↔admin histories.

export type NotificationTarget = { conversation_id: string; role: 'assistant'; content: string };

/** Pure: the conversation rows that must receive this notification. */
export function buildNotificationTargets(
  operatorConvId: string,
  mainConvId: string,
  content: string
): NotificationTarget[] {
  const ids = operatorConvId === mainConvId ? [operatorConvId] : [operatorConvId, mainConvId];
  return ids.map((conversation_id) => ({ conversation_id, role: 'assistant', content }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --require tsx/cjs --test eval_harness/unit/push-agent-notification-targets.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/push-agent-notification.ts eval_harness/unit/push-agent-notification-targets.test.ts
git commit -m "feat(agent): pure notification dual-write target builder"
```

---

### Task 5: `pushAgentNotification` — compose, send to Master topic, dual-write

**Files:**
- Modify: `lib/agent/push-agent-notification.ts` (add the async orchestrator)
- Read for context: `lib/agent/staff-report.ts` (`generateStaffReport`, `StaffEvent`), `lib/telegram/group-send-queue.ts` (`enqueueGroupSend`), `lib/db/conversations.ts` (`getOrCreateLeadOperator`, `getOrCreateMainAssistant`), `lib/db/messages.ts` (`addMessage`), `lib/db/agencies.ts` (`getAgencyById`), `lib/db/leads.ts` (`getLeadById`), `lib/db/admins.ts` or `lib/db` (admin lookup by agency), `lib/events.ts` (`broadcastConversationUpdate`)

**Interfaces:**
- Consumes: `buildNotificationTargets` (Task 4), `StaffEvent` (from `lib/agent/staff-report.ts`)
- Produces:
  - `pushAgentNotification(args: { agencyId: string; leadId: string; event: StaffEvent; lang?: Language }): Promise<void>`

- [ ] **Step 1: Add the orchestrator**

Append to `lib/agent/push-agent-notification.ts`:

```ts
import { generateStaffReport, type StaffEvent } from '@/lib/agent/staff-report';
import {
  getOrCreateLeadOperator,
  getOrCreateMainAssistant,
  getAgencyById,
  getLeadById,
  addMessage,
  listAdminsByAgency
} from '@/lib/db';
import { enqueueGroupSend } from '@/lib/telegram/group-send-queue';
import { formatAgentLabel } from '@/lib/telegram/agent-command';
import { broadcastConversationUpdate } from '@/lib/events';
import type { Language } from '@/lib/types';

export async function pushAgentNotification(args: {
  agencyId: string;
  leadId: string;
  event: StaffEvent;
  lang?: Language;
}): Promise<void> {
  const { agencyId, leadId, event } = args;
  const lang = args.lang ?? 'fr';

  // 1. Compose the notice as the operator of this lead.
  const body = await generateStaffReport(event, lang);
  const lead = await getLeadById(leadId);
  const label = formatAgentLabel({ agent_kind: 'operator', lead_id: leadId }, lead?.name);
  const content = `${label} — ${body}`;

  // 2. Resolve the two conversations (single admin per agency).
  const admins = await listAdminsByAgency(agencyId);
  const admin = admins[0];
  const operatorConv = await getOrCreateLeadOperator(leadId, agencyId);
  const mainConv = admin ? await getOrCreateMainAssistant(admin.id, agencyId) : null;

  // 3. Dual-write to DB histories (independent of Telegram delivery).
  const targets = buildNotificationTargets(
    operatorConv.id,
    mainConv?.id ?? operatorConv.id,
    content
  );
  for (const t of targets) {
    await addMessage({ conversation_id: t.conversation_id, role: t.role, content: t.content });
    broadcastConversationUpdate(t.conversation_id);
  }

  // 4. Send to the Master topic chat channel (non-fatal on failure).
  try {
    const agency = await getAgencyById(agencyId);
    if (agency?.telegram_group_chat_id && agency.telegram_master_topic_id !== null) {
      void enqueueGroupSend(agency.telegram_group_chat_id, content, {
        threadId: agency.telegram_master_topic_id,
        kind: 'critical'
      });
    }
  } catch (e) {
    console.error('[push-agent-notification] telegram send failed (non-fatal):', e);
  }
}
```

- [ ] **Step 2: Provide `listAdminsByAgency` if missing**

Run: `grep -rn "listAdminsByAgency\|function .*Admin.*Agency\|from(admins)" lib/db/*.ts`
Expected: confirm whether an "admins by agency" helper exists. If NOT, create `lib/db/admins.ts` (or extend the existing admins file) with:

```ts
import { eq } from 'drizzle-orm';
import { db } from './client';
import { admins } from './schema';

export async function listAdminsByAgency(agencyId: string) {
  return db.select().from(admins).where(eq(admins.agency_id, agencyId));
}
```

and export it from `lib/db/index.ts`. (Match the db import path used by neighboring helper files.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. Fix import paths to match existing helpers (`@/lib/db` barrel exports `getOrCreateLeadOperator`, `getOrCreateMainAssistant`, `getAgencyById`, `getLeadById`, `addMessage`).

- [ ] **Step 4: Run the full unit suite (no regressions)**

Run: `npm test`
Expected: all unit tests pass (including Tasks 1–4).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/push-agent-notification.ts lib/db/index.ts lib/db/admins.ts
git commit -m "feat(agent): pushAgentNotification — operator-composed, dual-written to both histories"
```

---

### Task 6: Master-topic hub — dispatch to active subagent + `/agent` selection + callbacks

**Files:**
- Modify: `lib/telegram/handle-group-telegram-message.ts` (`handleMasterTopicMessage`)
- Modify: `lib/telegram/handle-lead-telegram-update.ts` (add `callback_query` handling path)
- Modify: `app/api/telegram/route.ts` (ensure `callback_query` updates reach `handleTelegramUpdate`)
- Read for context: `lib/telegram/agent-command.ts`, `lib/db/telegram-agent-sessions.ts`, `lib/db/leads.ts` (`listLeads`), `lib/telegram/resolve-agency-admin.ts` (`resolveActingAdmin`), `lib/telegram/group-send-queue.ts`, `lib/agent/run.ts` (`runAgentTurn` actor types)

**Interfaces:**
- Consumes: `parseAgentCommand`, `parseAgentCallback`, `buildAgentKeyboard`, `formatAgentLabel`, `getAgentSession`, `setAgentSession`, `resolveActiveActor`
- Produces: `handleAgentCallback(chatId, agency, fromId, data, threadId): Promise<void>` (new export in `handle-group-telegram-message.ts`)

- [ ] **Step 1: Rewrite `handleMasterTopicMessage` to be the hub**

Replace the body of `handleMasterTopicMessage` in `lib/telegram/handle-group-telegram-message.ts` with command-aware dispatch. Keep the existing signature `(chatId, agency, fromId, text, threadId)`:

```ts
import { parseAgentCommand, buildAgentKeyboard, formatAgentLabel } from '@/lib/telegram/agent-command';
import { getAgentSession, setAgentSession, resolveActiveActor } from '@/lib/db/telegram-agent-sessions';
import { listLeads, getLeadById } from '@/lib/db';
import { sendTelegramKeyboard } from '@/lib/telegram/send-keyboard'; // added in Step 3

export async function handleMasterTopicMessage(
  chatId: string,
  agency: Agency,
  fromId: string,
  text: string,
  threadId: number
): Promise<void> {
  try {
    const admin = await resolveActingAdmin(fromId, agency.id);
    if (!admin) {
      void enqueueGroupSend(chatId, '❌ Aucun administrateur trouvé. / No admin found.', {
        threadId, kind: 'critical'
      });
      return;
    }

    const cmd = parseAgentCommand(text);

    // /agent — show picker (Main + recent leads)
    if (cmd.kind === 'show') {
      const leads = (await listLeads(agency.id)).slice(0, 8)
        .map((l) => ({ id: l.id, label: l.name ?? l.email ?? l.id.slice(0, 8) }));
      const session = await getAgentSession(agency.id);
      const current = formatAgentLabel(session, session?.agent_kind === 'operator'
        ? (await getLeadById(session.lead_id))?.name : null);
      await sendTelegramKeyboard(
        chatId,
        `Actuel : ${current}\nChoisissez l'agent : / Choose agent:`,
        buildAgentKeyboard(leads),
        threadId
      );
      return;
    }

    // /agent main
    if (cmd.kind === 'set_main') {
      await setAgentSession(agency.id, { agent_kind: 'main', lead_id: null });
      void enqueueGroupSend(chatId, '✅ Agent : 🤖 Main', { threadId, kind: 'critical' });
      return;
    }

    // /agent lead <query>
    if (cmd.kind === 'set_lead') {
      const q = cmd.query.toLowerCase();
      const match = (await listLeads(agency.id)).find(
        (l) => (l.name ?? '').toLowerCase().includes(q) || (l.email ?? '').toLowerCase().includes(q)
      );
      if (!match) {
        void enqueueGroupSend(chatId, `❌ Lead introuvable : "${cmd.query}"`, { threadId, kind: 'critical' });
        return;
      }
      await setAgentSession(agency.id, { agent_kind: 'operator', lead_id: match.id });
      void enqueueGroupSend(chatId, `✅ Agent : ${formatAgentLabel({ agent_kind: 'operator', lead_id: match.id }, match.name)}`, { threadId, kind: 'critical' });
      return;
    }

    // Plain text → dispatch to active subagent
    const session = await getAgentSession(agency.id);
    const actor = resolveActiveActor(session);
    if (!actor) {
      void enqueueGroupSend(chatId, 'ℹ️ Aucun agent sélectionné. Tapez /agent pour choisir.', { threadId, kind: 'critical' });
      return;
    }

    if (actor.type === 'operator') {
      const conv = await getOrCreateLeadOperator(actor.leadId, agency.id);
      const lead = await getLeadById(actor.leadId);
      const result = await runAgentTurn(conv.id, text, {
        type: 'operator', leadId: actor.leadId, adminId: admin.id, adminName: admin.name
      });
      if (result.reply.trim()) {
        void enqueueGroupSend(chatId,
          `${formatAgentLabel(session, lead?.name)} — ${result.reply}`,
          { threadId, kind: 'critical' });
      }
      return;
    }

    // main_assistant
    const conv = await getOrCreateMainAssistant(admin.id, agency.id);
    const result = await runAgentTurn(conv.id, text, {
      type: 'main_assistant', adminId: admin.id, adminName: admin.name
    });
    if (result.reply.trim()) {
      void enqueueGroupSend(chatId, `🤖 Main — ${result.reply}`, { threadId, kind: 'critical' });
    }
  } catch (err) {
    console.error('[master-topic] handleMasterTopicMessage error:', err);
    void enqueueGroupSend(chatId, '❌ Erreur interne. / Internal error.', { threadId, kind: 'critical' });
  }
}
```

Add the imports for `getOrCreateLeadOperator` / `getLeadById` to the file's existing `@/lib/db` import if not present.

- [ ] **Step 2: Add `handleAgentCallback` for inline-keyboard taps**

In the same file, add:

```ts
import { parseAgentCallback } from '@/lib/telegram/agent-command';

/** Handle an inline-keyboard tap (callback_query.data) in the Master topic. */
export async function handleAgentCallback(
  chatId: string,
  agency: Agency,
  data: string,
  threadId: number
): Promise<void> {
  const cb = parseAgentCallback(data);
  if (!cb) return;
  if (cb.kind === 'main') {
    await setAgentSession(agency.id, { agent_kind: 'main', lead_id: null });
    void enqueueGroupSend(chatId, '✅ Agent : 🤖 Main', { threadId, kind: 'critical' });
    return;
  }
  const lead = await getLeadById(cb.leadId);
  if (!lead || lead.agency_id !== agency.id) {
    void enqueueGroupSend(chatId, '❌ Lead invalide.', { threadId, kind: 'critical' });
    return;
  }
  await setAgentSession(agency.id, { agent_kind: 'operator', lead_id: cb.leadId });
  void enqueueGroupSend(chatId, `✅ Agent : ${formatAgentLabel({ agent_kind: 'operator', lead_id: cb.leadId }, lead.name)}`, { threadId, kind: 'critical' });
}
```

- [ ] **Step 3: Add a keyboard sender + (optional) answerCallbackQuery**

Run: `grep -rn "api.telegram.org\|sendMessage\|TELEGRAM_BOT_TOKEN" lib/telegram/*.ts | head` to find the low-level Telegram fetch wrapper (mirror `sendTelegramMessage`).

Create `lib/telegram/send-keyboard.ts` mirroring that wrapper:

```ts
import { sendTelegramRaw } from '@/lib/telegram'; // use the actual low-level caller found above

export async function sendTelegramKeyboard(
  chatId: string,
  text: string,
  keyboard: { inline_keyboard: { text: string; callback_data: string }[][] },
  threadId?: number
): Promise<void> {
  await sendTelegramRaw('sendMessage', {
    chat_id: chatId,
    text,
    ...(threadId ? { message_thread_id: threadId } : {}),
    reply_markup: keyboard
  });
}
```

If no generic `sendTelegramRaw` exists, mirror the fetch in `sendTelegramMessage` (POST `https://api.telegram.org/bot${token}/sendMessage`) and add a `reply_markup` field. Keep the file < 60 LOC.

- [ ] **Step 4: Route `callback_query` updates to the handler**

In `lib/telegram/handle-lead-telegram-update.ts`, near the top of `handleTelegramUpdate`, before the message branch, add:

```ts
// Inline-keyboard taps arrive as callback_query, not message.
if (update.callback_query) {
  const cq = update.callback_query;
  const chatId = String(cq.message?.chat?.id ?? '');
  const threadId = cq.message?.message_thread_id;
  const data = cq.data ?? '';
  const agency = chatId ? await getAgencyByTelegramGroup(chatId) : null;
  if (agency && agency.telegram_master_topic_id !== null && threadId === agency.telegram_master_topic_id) {
    await handleAgentCallback(chatId, agency, data, threadId);
    return 'group';
  }
  return 'ignored';
}
```

Confirm the `Update` type includes `callback_query` (it is raw Telegram JSON; widen the local type if needed). In `app/api/telegram/route.ts`, confirm the whole parsed update body is passed to `handleTelegramUpdate` (it already forwards `update`); no change if so.

- [ ] **Step 5: Typecheck + unit suite**

Run: `npm run typecheck` → no errors.
Run: `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/telegram/handle-group-telegram-message.ts lib/telegram/handle-lead-telegram-update.ts lib/telegram/send-keyboard.ts app/api/telegram/route.ts
git commit -m "feat(telegram): Master-topic /agent hub — pick subagent + dispatch + callbacks"
```

---

### Task 7: Wire notifications to `pushAgentNotification`

**Files:**
- Modify: `lib/agent/run.ts:115-143` (manual-mode + handoff branches)
- Modify: `lib/agent/tools/operator-lead-actions.ts:160-190` (booking + handoff_requested)
- Read for context: `lib/agent/push-agent-notification.ts`, `lib/agent/staff-report.ts` (`StaffEvent` variants: `handoff`, `manual`, `viewing_booked`, `handoff_requested`)

**Interfaces:**
- Consumes: `pushAgentNotification` (Task 5)

- [ ] **Step 1: Replace notify calls in `run.ts`**

In `lib/agent/run.ts`, the manual-mode branch currently calls `generateStaffReport` then `notifyAgency(...)` + `notifyAdminsInChat(...)`. Replace both notify calls with a single dual-writing push. Manual-mode branch (around line 115-122):

```ts
// manual mode: lead messaged a manual-mode conversation
if (conversation.lead_id) {
  void pushAgentNotification({
    agencyId: conversation.agency_id,
    leadId: conversation.lead_id,
    event: { kind: 'manual', message: message.slice(0, 300) },
    lang: detectedLang
  });
}
```

Handoff branch (around line 138-143): replace the `generateStaffReport` + `notifyAgency` pair with:

```ts
if (conversation.lead_id) {
  void pushAgentNotification({
    agencyId: conversation.agency_id,
    leadId: conversation.lead_id,
    event: { kind: 'handoff', rule: rule.description, message: message.slice(0, 300) },
    lang: detectedLang
  });
}
```

Remove now-unused imports (`notifyAgency`, `notifyAdminsInChat`, and `generateStaffReport` if no longer referenced in `run.ts`). Add `import { pushAgentNotification } from '@/lib/agent/push-agent-notification';`. Confirm the exact `StaffEvent` field names against `lib/agent/staff-report.ts` (`handoff` → `{ rule, message }`, `manual` → `{ message }`).

- [ ] **Step 2: Replace notify calls in `operator-lead-actions.ts`**

In `lib/agent/tools/operator-lead-actions.ts`, the booking path (line ~168) calls `notifyAdmins(await generateStaffReport({ kind: 'viewing_booked', ... }))` and handoff_requested (line ~184) calls `notifyAdmins(summary)`. Where a `leadId` is in scope, replace with:

```ts
// booking confirmed
void pushAgentNotification({
  agencyId: ctx.config.agency_id,
  leadId: <leadIdInScope>,
  event: { kind: 'viewing_booked', title: listing.title, slot: formatSlot(slot), contact },
  lang: ctx.lang
});
```

```ts
// handoff requested
void pushAgentNotification({
  agencyId: ctx.config.agency_id,
  leadId: <leadIdInScope>,
  event: { kind: 'handoff_requested', reason, leadName: lead?.name },
  lang: ctx.lang
});
```

Keep `notifyAdmins` only for any path with NO lead in scope. Confirm `leadId` variable names from the surrounding code before editing.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (and no "unused import" type errors — remove dead imports).

- [ ] **Step 4: Run agent + unit suites**

Run: `npm test && npm run test:agent`
Expected: all pass. If a thread-pipeline/rules test asserted the old `notifyAgency` path, update it to assert `pushAgentNotification` instead (search `eval_harness` for `notifyAgency`/`notifyAdminsInChat`).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/run.ts lib/agent/tools/operator-lead-actions.ts
git commit -m "feat(agent): route lead notifications through pushAgentNotification (dual-write)"
```

---

## Self-Review

**Spec coverage:**
- §2.1 Hub + `/agent` → Tasks 2, 3, 6. ✓
- §2.2 agency-scoped session table → Task 1. ✓
- §2.3 notification redesign (operator-composed, Master topic, dual-write) → Tasks 4, 5, 7. ✓
- §2.4 reduce tabs → already satisfied by `telegram_topics_enabled=false` default (Global Constraints documents leaving it off; no task needed — verify no code path enables it). ✓
- §3 inbound routing (Master hub + callback_query) → Task 6. ✓

**Placeholder scan:** `<leadIdInScope>` / `<leadId>` markers in Task 7 are deliberate — the exact variable name must be read from surrounding code; Step instructions say to confirm before editing. All pure-function tasks contain complete code + tests.

**Type consistency:** `AgentSession`, `ActiveActor`, `AgentCommand`, `AgentCallback`, `NotificationTarget`, `StaffEvent` used consistently across Tasks 1–7. `formatAgentLabel` / `buildAgentKeyboard` signatures match between definition (Task 3) and use (Tasks 5, 6).

## Unresolved questions

1. Recent-lead ordering for `/agent` keyboard — plan uses `listLeads(...).slice(0,8)`; confirm whether to order by last activity (would need a sorted query) vs default order. Low risk.
2. `answerCallbackQuery` (stops Telegram's button spinner) — Task 6 Step 3 leaves it optional; add if UX needs it.
3. Whether to also surface the agent label inside the web UI (store a `source` on the message) — spec §9 deferred; plan stores plain content only.
