# Main Assistant Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `main_assistant` agent — a system-wide super-admin agent with full visibility and control over leads, listings, calendar, and subagents — accessible via a new "Assistant" tab and as the primary Telegram bot for admins.

**Architecture:** New `main_assistant` actor type in `run.ts` with its own conversation type, system prompt, and rich tool set. The existing agents remain unchanged. Telegram admin routing switches from `admin_assistant` to `main_assistant`.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM (Postgres), Vercel AI SDK (`ai`), Google Calendar API, Telegram Bot API

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Edit | `lib/types.ts` | Add `'main_assistant'` to `ConversationType` |
| Edit | `lib/db/conversations.ts` | Add `getOrCreateMainAssistant()` |
| Edit | `lib/db/viewings.ts` | Add `cancelViewing()`, `rescheduleViewing()` |
| Edit | `lib/calendar.ts` | Add `deleteCalendarEvent()` |
| Create | `lib/agent/tools/main-assistant-tools.ts` | All main assistant tools |
| Create | `lib/agent/prompts/main-assistant-prompt.ts` | System prompt builder |
| Edit | `lib/agent/run.ts` | Add `main_assistant` actor branch |
| Create | `app/api/admin/assistant/route.ts` | GET/POST API for the assistant chat |
| Create | `components/admin/assistant-panel.tsx` | Chat UI panel for the new tab |
| Edit | `components/admin/admin-shell.tsx` | Add "Assistant" tab |
| Edit | `lib/telegram/handle-lead-telegram-update.ts` | Route admin Telegram → main_assistant |

---

## Task 1: Add ConversationType and DB function

**Files:**
- Modify: `lib/types.ts:15-19`
- Modify: `lib/db/conversations.ts` (after `getOrCreateAdminAssistant`)

- [ ] **Step 1: Add `main_assistant` to ConversationType**

In `lib/types.ts`, find:
```ts
export type ConversationType =
  | 'lead'
  | 'lead_steward'
  | 'anonymous_steward'
  | 'admin_assistant';
```
Replace with:
```ts
export type ConversationType =
  | 'lead'
  | 'lead_steward'
  | 'anonymous_steward'
  | 'admin_assistant'
  | 'main_assistant';
```

- [ ] **Step 2: Add `getOrCreateMainAssistant` to `lib/db/conversations.ts`**

After the `getOrCreateAdminAssistant` function (around line 126), add:

```ts
export async function getMainAssistantConversation(
  adminId: string
): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.type, 'main_assistant'),
        eq(conversations.admin_id, adminId)
      )
    )
    .orderBy(desc(conversations.updated_at))
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function getOrCreateMainAssistant(
  adminId: string
): Promise<Conversation> {
  return (
    (await getMainAssistantConversation(adminId)) ??
    (await createConversation({
      type: 'main_assistant',
      admin_id: adminId,
      primary_channel: 'web'
    }))
  );
}
```

- [ ] **Step 3: Compile check**

```bash
cd /mnt/dunghd/lead-agent-chat && npx tsc --noEmit 2>&1 | head -20
```
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/db/conversations.ts
git commit -m "feat(db): add main_assistant conversation type and getOrCreateMainAssistant"
```

---

## Task 2: Add calendar delete + viewing cancel/reschedule to DB

**Files:**
- Modify: `lib/calendar.ts`
- Modify: `lib/db/viewings.ts`

- [ ] **Step 1: Add `deleteCalendarEvent` to `lib/calendar.ts`**

At the end of `lib/calendar.ts`, add:

```ts
export async function deleteCalendarEvent(args: {
  calendarId: string;
  eventId: string;
}): Promise<void> {
  const auth = getAuth();
  if (!auth) return;
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    await calendar.events.delete({ calendarId: args.calendarId, eventId: args.eventId });
  } catch (e) {
    console.warn('[calendar] deleteCalendarEvent failed (may already be deleted):', e);
  }
}
```

- [ ] **Step 2: Add `cancelViewing` and `rescheduleViewing` to `lib/db/viewings.ts`**

At the end of `lib/db/viewings.ts`, add:

```ts
export async function cancelViewing(viewingId: string): Promise<ViewingSlot | null> {
  const rows = await db
    .update(viewing_slots)
    .set({ status: 'cancelled' })
    .where(eq(viewing_slots.id, viewingId))
    .returning();
  return rows[0] ? rowToViewing(rows[0]) : null;
}

export async function rescheduleViewing(
  viewingId: string,
  newSlotIso: string
): Promise<ViewingSlot | null> {
  const rows = await db
    .update(viewing_slots)
    .set({ confirmed_slot: new Date(newSlotIso) })
    .where(eq(viewing_slots.id, viewingId))
    .returning();
  return rows[0] ? rowToViewing(rows[0]) : null;
}
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/calendar.ts lib/db/viewings.ts
git commit -m "feat(calendar): add deleteCalendarEvent, cancelViewing, rescheduleViewing"
```

---

## Task 3: Build main assistant tools

**Files:**
- Create: `lib/agent/tools/main-assistant-tools.ts`

- [ ] **Step 1: Create `lib/agent/tools/main-assistant-tools.ts`**

```ts
import { tool } from 'ai';
import { z } from 'zod';
import {
  listLeads,
  getLeadById,
  getConversationByLeadId,
  getVisibleMessages,
  addMessage,
  updateConversation,
  updateCriteria,
  upsertAgencyConfig,
  listListings,
  getListing,
  createListing,
  updateListing,
  listBookedViewings,
  cancelViewing,
  rescheduleViewing,
  getOrCreateLeadSteward,
  admins
} from '@/lib/db';
import { db } from '@/lib/db/client';
import { deleteCalendarEvent, getAvailableSlots, createCalendarEvent } from '@/lib/calendar';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import { notifyAdmins } from '@/lib/notify';
import { criterionSchema, listingSchema } from '@/lib/types';
import { formatPrice, formatSlot } from '@/lib/format';
import { runAgentTurn } from '@/lib/agent/run';
import type { AgentContext } from './context';

export function buildMainAssistantTools(
  ctx: AgentContext,
  adminId: string,
  adminName: string | null
) {
  return {
    // ─── Lead Management ────────────────────────────────────────────────────

    query_leads: tool({
      description: 'List/filter leads by status, potential, listing, or recency.',
      inputSchema: z.object({
        status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
        potential: z.enum(['hot', 'warm', 'cold']).optional(),
        listing_id: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional()
      }),
      execute: async ({ status, potential, listing_id, limit }) => {
        let leads = await listLeads();
        if (status) leads = leads.filter((l) => l.status === status);
        if (potential) leads = leads.filter((l) => l.potential_status === potential);
        if (listing_id) leads = leads.filter((l) => l.listing_id === listing_id);
        return leads.slice(0, limit ?? 20).map((l) => ({
          id: l.id,
          email: l.email,
          name: l.name,
          listing_id: l.listing_id,
          status: l.status,
          potential: l.potential_status,
          reason: l.score_reason,
          updated_at: l.updated_at
        }));
      }
    }),

    get_lead_detail: tool({
      description: "Read a lead's full profile, qualification state, and conversation messages.",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const lead = await getLeadById(lead_id);
        if (!lead) return { error: 'lead_not_found' };
        const conv = await getConversationByLeadId(lead_id);
        const messages = conv ? await getVisibleMessages(conv.id) : [];
        return {
          lead: {
            email: lead.email,
            name: lead.name,
            status: lead.status,
            potential: lead.potential_status,
            qual_values: lead.qual_values,
            score_reason: lead.score_reason,
            long_term_memory: lead.long_term_memory
          },
          conversation_id: conv?.id ?? null,
          mode: conv?.mode ?? null,
          messages: messages.slice(-20).map((m) => ({ role: m.role, content: m.content }))
        };
      }
    }),

    send_reply: tool({
      description: 'Send a message to a lead on their active channel immediately.',
      inputSchema: z.object({ lead_id: z.string(), content: z.string().min(1) }),
      execute: async ({ lead_id, content }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await addMessage({ conversation_id: conv.id, role: 'admin', content });
        await dispatchReply(conv, content);
        broadcastConversationUpdate(conv.id);
        return { ok: true, sent: true };
      }
    }),

    draft_reply: tool({
      description: 'Save a draft message to a lead (not sent). Returns the draft text for review.',
      inputSchema: z.object({ lead_id: z.string(), content: z.string().min(1) }),
      execute: async ({ lead_id, content }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await addMessage({ conversation_id: conv.id, role: 'assistant', content, is_draft: true });
        broadcastConversationUpdate(conv.id);
        return { ok: true, draft: content };
      }
    }),

    take_over: tool({
      description: "Switch a lead's conversation to manual mode — agent stops auto-replying.",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await updateConversation(conv.id, { mode: 'manual' });
        broadcastConversationUpdate(conv.id);
        return { ok: true, mode: 'manual' };
      }
    }),

    release_conversation: tool({
      description: 'Return a lead conversation to agent mode (auto-reply resumes).',
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };
        await updateConversation(conv.id, { mode: 'agent' });
        broadcastConversationUpdate(conv.id);
        return { ok: true, mode: 'agent' };
      }
    }),

    // ─── Listing Management ─────────────────────────────────────────────────

    list_listings: tool({
      description: 'List all property listings.',
      inputSchema: z.object({}),
      execute: async () => {
        const listings = await listListings();
        return listings.map((l) => ({
          id: l.id,
          title: l.title,
          address: l.address,
          price: formatPrice(l.price),
          rooms: l.rooms,
          surface_m2: l.surface_m2,
          agent_name: l.agent_name
        }));
      }
    }),

    create_listing: tool({
      description: 'Create a new property listing.',
      inputSchema: listingSchema,
      execute: async (input) => {
        const listing = await createListing(input);
        return { ok: true, id: listing.id, title: listing.title };
      }
    }),

    update_listing: tool({
      description: 'Update an existing listing (price, title, description, rooms, surface, etc.).',
      inputSchema: listingSchema.partial().extend({ id: z.string() }),
      execute: async ({ id, ...fields }) => {
        const existing = await getListing(id);
        if (!existing) return { error: 'listing_not_found' };
        const updated = await updateListing(id, fields);
        return { ok: true, id: updated.id, title: updated.title };
      }
    }),

    // ─── Calendar & Viewings ────────────────────────────────────────────────

    list_viewings: tool({
      description: 'List all booked viewings across all leads.',
      inputSchema: z.object({}),
      execute: async () => {
        const viewings = await listBookedViewings();
        return viewings.map((v) => ({
          id: v.id,
          lead_id: v.lead_id,
          listing_id: v.listing_id,
          contact_email: v.contact_email,
          slot: v.confirmed_slot ? formatSlot(v.confirmed_slot.toString()) : null,
          status: v.status,
          calendar_event_id: v.calendar_event_id
        }));
      }
    }),

    cancel_viewing: tool({
      description: 'Cancel a booked viewing and delete the calendar event.',
      inputSchema: z.object({ viewing_id: z.string() }),
      execute: async ({ viewing_id }) => {
        const viewings = await listBookedViewings();
        const v = viewings.find((x) => x.id === viewing_id);
        if (!v) return { error: 'viewing_not_found' };
        if (v.calendar_event_id) {
          const listing = v.listing_id ? await getListing(v.listing_id) : null;
          const calendarId = listing?.agent_calendar_id || ctx.config.calendar_id;
          await deleteCalendarEvent({ calendarId, eventId: v.calendar_event_id });
        }
        await cancelViewing(viewing_id);
        return { ok: true, cancelled: true };
      }
    }),

    reschedule_viewing: tool({
      description: 'Reschedule a booked viewing to a new slot. Use list_available_slots first.',
      inputSchema: z.object({ viewing_id: z.string(), new_slot_iso: z.string() }),
      execute: async ({ viewing_id, new_slot_iso }) => {
        const viewings = await listBookedViewings();
        const v = viewings.find((x) => x.id === viewing_id);
        if (!v) return { error: 'viewing_not_found' };
        await rescheduleViewing(viewing_id, new_slot_iso);
        return { ok: true, new_slot: formatSlot(new_slot_iso) };
      }
    }),

    list_available_slots: tool({
      description: 'List available viewing slots for a listing.',
      inputSchema: z.object({ listing_id: z.string(), count: z.number().int().min(1).max(5).optional() }),
      execute: async ({ listing_id, count }) => {
        const listing = await getListing(listing_id);
        if (!listing) return { error: 'listing_not_found' };
        const slots = await getAvailableSlots({
          calendarId: listing.agent_calendar_id || ctx.config.calendar_id,
          preferredTimeline: null,
          count: count ?? 3
        });
        return { slots: slots.map((iso) => ({ iso, label: formatSlot(iso) })) };
      }
    }),

    // ─── Analytics ──────────────────────────────────────────────────────────

    pipeline_summary: tool({
      description: 'Get lead pipeline counts by status and potential.',
      inputSchema: z.object({}),
      execute: async () => {
        const leads = await listLeads();
        const byStatus = leads.reduce<Record<string, number>>((acc, l) => {
          acc[l.status ?? 'unknown'] = (acc[l.status ?? 'unknown'] ?? 0) + 1;
          return acc;
        }, {});
        const byPotential = leads.reduce<Record<string, number>>((acc, l) => {
          const k = l.potential_status ?? 'unscored';
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {});
        const booked = leads.filter((l) => l.status === 'booked').length;
        const total = leads.length;
        return {
          total,
          by_status: byStatus,
          by_potential: byPotential,
          booking_rate: total > 0 ? `${Math.round((booked / total) * 100)}%` : '0%'
        };
      }
    }),

    weekly_report: tool({
      description: 'Summary of the last 7 days: new leads, bookings, handoffs.',
      inputSchema: z.object({}),
      execute: async () => {
        const leads = await listLeads();
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recent = leads.filter((l) => l.created_at && new Date(l.created_at) >= cutoff);
        const viewings = await listBookedViewings();
        const recentViewings = viewings.filter(
          (v) => v.created_at && new Date(v.created_at) >= cutoff
        );
        return {
          new_leads: recent.length,
          new_bookings: recentViewings.length,
          handoffs: recent.filter((l) => l.status === 'handoff').length,
          hot_leads: leads.filter((l) => l.potential_status === 'hot').length
        };
      }
    }),

    // ─── Subagent Triggers ──────────────────────────────────────────────────

    trigger_steward_briefing: tool({
      description:
        'Run the lead steward agent for a specific lead and return a full briefing. Use before advising on complex leads.',
      inputSchema: z.object({ lead_id: z.string(), question: z.string().max(400).optional() }),
      execute: async ({ lead_id, question }) => {
        const lead = await getLeadById(lead_id);
        if (!lead) return { error: 'lead_not_found' };
        const stewardConv = await getOrCreateLeadSteward(lead_id);
        const prompt = question
          ? `${question} Please review this lead's full profile and give a concise briefing.`
          : `Please review this lead's full profile and conversation history. Give me a concise briefing: who they are, what they want, their qualification status, and recommended next action.`;
        const result = await runAgentTurn(stewardConv.id, prompt, {
          type: 'lead_steward',
          leadId: lead_id,
          adminId,
          adminName
        });
        return { ok: true, briefing: result.reply };
      }
    }),

    trigger_lead_turn: tool({
      description:
        'Inject a message into a lead conversation and run the lead agent. Use to have the bot send a specific response.',
      inputSchema: z.object({ conversation_id: z.string(), message: z.string().min(1).max(1000) }),
      execute: async ({ conversation_id, message }) => {
        const result = await runAgentTurn(conversation_id, message, { type: 'lead' });
        return { ok: true, reply: result.reply };
      }
    }),

    // ─── System Config ──────────────────────────────────────────────────────

    update_criteria: tool({
      description: 'Replace agency qualification criteria. Takes effect on next lead turn.',
      inputSchema: z.object({ criteria: z.array(criterionSchema).min(1) }),
      execute: async ({ criteria }) => {
        ctx.config = await updateCriteria(criteria);
        return { ok: true, criteria: ctx.config.qualification_criteria };
      }
    }),

    update_config: tool({
      description: 'Adjust agency name and/or tone.',
      inputSchema: z.object({
        name: z.string().max(255).optional(),
        tone: z.string().max(1000).optional()
      }),
      execute: async ({ name, tone }) => {
        ctx.config = await upsertAgencyConfig({
          ...ctx.config,
          name: name ?? ctx.config.name,
          tone: tone ?? ctx.config.tone
        });
        return { ok: true, name: ctx.config.name };
      }
    }),

    notify_admin: tool({
      description: 'Send a Telegram notification to admins.',
      inputSchema: z.object({ summary: z.string().max(280) }),
      execute: async ({ summary }) => {
        await notifyAdmins(summary);
        return { ok: true };
      }
    })
  };
}
```

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no output. Fix any import errors (check `@/lib/db` exports include `getOrCreateLeadSteward`, `admins`, `listLeads` etc.).

> **Note:** `admins` import added above is unused — remove it if the compiler warns. `runAgentTurn` creates a circular import risk; verify it compiles fine since `run.ts` will import from this file. If there's a circular import, extract `trigger_*` tool logic into a thin wrapper that takes `runAgentTurn` as a parameter.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/tools/main-assistant-tools.ts
git commit -m "feat(agent): add main assistant tools (leads, listings, calendar, analytics, subagents)"
```

---

## Task 4: Build main assistant system prompt

**Files:**
- Create: `lib/agent/prompts/main-assistant-prompt.ts`

- [ ] **Step 1: Create `lib/agent/prompts/main-assistant-prompt.ts`**

```ts
import { listLeads, listBookedViewings, listListings, getConversation } from '@/lib/db';
import type { AgencyConfig } from '@/lib/types';

export async function buildMainAssistantSystemPrompt(args: {
  config: AgencyConfig;
  adminName: string | null;
}): Promise<string> {
  const { config, adminName } = args;

  // Build live system snapshot
  const [leads, viewings, listings] = await Promise.all([
    listLeads(),
    listBookedViewings(),
    listListings()
  ]);

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingViewings = viewings.filter((v) => {
    if (!v.confirmed_slot) return false;
    const slot = new Date(v.confirmed_slot);
    return slot >= now && slot <= weekAhead;
  });

  const hotCount = leads.filter((l) => l.potential_status === 'hot').length;
  const warmCount = leads.filter((l) => l.potential_status === 'warm').length;
  const handoffCount = leads.filter((l) => l.status === 'handoff').length;

  const snapshot = `[SYSTEM SNAPSHOT]
Total leads: ${leads.length} (hot: ${hotCount}, warm: ${warmCount}, handoff: ${handoffCount})
Active listings: ${listings.length}
Upcoming viewings (next 7 days): ${upcomingViewings.length}`;

  return `[ROLE]
You are the main assistant for ${adminName ?? 'the admin'} at ${config.name}.
You have full visibility and control over the entire system: leads, listings, calendar, conversations, and subagents.
You act on behalf of the admin — anything they can do, you can do.
When admin asks you to do something, do it — don't just describe what they should do.

${snapshot}

[SUBAGENTS]
- trigger_steward_briefing(lead_id): Run the lead analysis agent for a specific lead and return a full briefing. Use before advising on complex leads or handoffs.
- trigger_lead_turn(conversation_id, message): Inject a message into a lead's conversation and run the lead agent. Use when admin wants the bot to send a specific reply.

[TOOLS — WHEN TO USE]
- Tóm tắt / báo cáo → pipeline_summary, weekly_report
- Xem / lọc leads → query_leads (quick list), get_lead_detail (full profile + messages)
- Cần hiểu sâu lead → trigger_steward_briefing BEFORE advising
- Gửi tin nhắn → send_reply (immediate), draft_reply (save for review)
- Kiểm soát conversation → take_over (stop bot), release_conversation (resume bot)
- Quản lý lịch → list_viewings, list_available_slots, cancel_viewing, reschedule_viewing
- Cập nhật listing → list_listings, update_listing, create_listing
- Cấu hình agency → update_criteria, update_config

[TONE]
Concise, professional. Reply in whatever language the admin writes in.
When reporting data, use tables or bullet lists. When taking action, confirm what was done.
Never ask for permission to use tools — just use them and report results.`;
}
```

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/prompts/main-assistant-prompt.ts
git commit -m "feat(agent): add main assistant system prompt with live system snapshot"
```

---

## Task 5: Add main_assistant actor to run.ts

**Files:**
- Modify: `lib/agent/run.ts`

- [ ] **Step 1: Add import for new tools and prompt**

At the top of `lib/agent/run.ts`, add two imports after the existing prompt/tools imports:

```ts
import { buildMainAssistantTools } from '@/lib/agent/tools/main-assistant-tools';
import { buildMainAssistantSystemPrompt } from '@/lib/agent/prompts/main-assistant-prompt';
```

- [ ] **Step 2: Extend Actor type**

Find:
```ts
export type Actor =
  | { type: 'lead' }
  | { type: 'admin'; adminId: string; adminName: string | null }
  | { type: 'lead_steward'; leadId: string; adminId: string; adminName: string | null }
  | { type: 'anonymous_steward'; adminId: string; adminName: string | null };
```
Replace with:
```ts
export type Actor =
  | { type: 'lead' }
  | { type: 'admin'; adminId: string; adminName: string | null }
  | { type: 'lead_steward'; leadId: string; adminId: string; adminName: string | null }
  | { type: 'anonymous_steward'; adminId: string; adminName: string | null }
  | { type: 'main_assistant'; adminId: string; adminName: string | null };
```

- [ ] **Step 3: Add shouldDispatchReply case**

Find:
```ts
function shouldDispatchReply(conversation: Conversation): boolean {
  if (conversation.type === 'lead') return true;
  if (conversation.type === 'admin_assistant') return true;
  return false;
}
```
Replace with:
```ts
function shouldDispatchReply(conversation: Conversation): boolean {
  if (conversation.type === 'lead') return true;
  if (conversation.type === 'admin_assistant') return true;
  if (conversation.type === 'main_assistant') return true;
  return false;
}
```

- [ ] **Step 4: Add main_assistant actor branch in runAgentTurn**

Find the if/else chain:
```ts
  if (actor.type === 'admin') {
    system = buildAdminSystemPrompt({ config, adminName: actor.adminName });
    tools = buildAdminTools(ctx);
  } else if (actor.type === 'lead_steward') {
```
Add a new branch before `actor.type === 'admin'`:
```ts
  if (actor.type === 'main_assistant') {
    system = await buildMainAssistantSystemPrompt({ config, adminName: actor.adminName });
    tools = buildMainAssistantTools(ctx, actor.adminId, actor.adminName);
  } else if (actor.type === 'admin') {
    system = buildAdminSystemPrompt({ config, adminName: actor.adminName });
    tools = buildAdminTools(ctx);
  } else if (actor.type === 'lead_steward') {
```

- [ ] **Step 5: Fix messages selection for main_assistant**

Find:
```ts
  const messages =
    actor.type === 'lead'
      ? await buildThreadContextMessages(conversationId)
      : toModelMessages(await getVisibleMessages(conversationId));
```
Replace with:
```ts
  const messages =
    actor.type === 'lead'
      ? await buildThreadContextMessages(conversationId)
      : toModelMessages(await getVisibleMessages(conversationId));
  // main_assistant uses getVisibleMessages (same as admin branch above — no change needed)
```
(No code change needed here — `main_assistant` correctly falls into the else branch.)

- [ ] **Step 6: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/agent/run.ts
git commit -m "feat(agent): add main_assistant actor type to runAgentTurn"
```

---

## Task 6: Create API endpoint

**Files:**
- Create: `app/api/admin/assistant/route.ts`

- [ ] **Step 1: Create `app/api/admin/assistant/route.ts`**

```ts
import { z } from 'zod';
import { getOrCreateMainAssistant, getVisibleMessages } from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';
import { runAgentTurn } from '@/lib/agent/run';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const admin = await requireAdmin();
    const conv = await getOrCreateMainAssistant(admin.id);
    const messages = await getVisibleMessages(conv.id);
    return Response.json({
      conversationId: conv.id,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content
      }))
    });
  } catch (e) {
    return toAuthResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }
}

const postSchema = z.object({ message: z.string().min(1).max(4000) });

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: 'invalid_input' }, { status: 400 });
    }
    const conv = await getOrCreateMainAssistant(admin.id);
    const result = await runAgentTurn(conv.id, parsed.data.message, {
      type: 'main_assistant',
      adminId: admin.id,
      adminName: admin.name
    });
    const messages = await getVisibleMessages(conv.id);
    return Response.json({
      conversationId: conv.id,
      reply: result.reply,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content
      }))
    });
  } catch (e) {
    const authRes = toAuthResponse(e);
    if (authRes) return authRes;
    console.error('[admin/assistant] failed:', e);
    return Response.json({ error: 'agent_error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/assistant/route.ts
git commit -m "feat(api): add /api/admin/assistant endpoint for main assistant agent"
```

---

## Task 7: Build AssistantPanel UI component

**Files:**
- Create: `components/admin/assistant-panel.tsx`

- [ ] **Step 1: Create `components/admin/assistant-panel.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageList, ChatShell, ChatTypingIndicator } from '@/components/chat/chat-shell';
import { useLang } from '@/components/lang-provider';

type Msg = { id: string; role: string; content: string };

export function AssistantPanel() {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useLang();

  useEffect(() => {
    fetch('/api/admin/assistant')
      .then(async (r) => {
        if (r.status === 401) {
          router.push('/admin/login');
          router.refresh();
          return null;
        }
        if (!r.ok) throw new Error('load_failed');
        return r.json();
      })
      .then((d) => {
        if (d?.messages) setMessages(d.messages);
      })
      .catch(() => setLoadError('load_failed'));
  }, [router]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: text }]);
    try {
      const res = await fetch('/api/admin/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      if (res.status === 401) {
        router.push('/admin/login');
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error('agent_error');
      if (data.messages) setMessages(data.messages);
    } catch {
      setLoadError('agent_error');
    } finally {
      setSending(false);
    }
  }

  return (
    <ChatShell
      title="Main Assistant"
      subtitle="Full system control — leads, listings, calendar, subagents"
      heightClass="h-[640px]"
      footer={
        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          placeholder="Ask anything or give a command..."
          sendLabel={t.send}
          disabled={sending}
        />
      }
    >
      {loadError && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          Failed to load assistant.
        </p>
      )}
      <ChatMessageList scrollRef={scrollRef}>
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Ask anything: "Who are the hottest leads?", "Reschedule viewing X", "Send a follow-up to lead Y"
          </p>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {sending && <ChatTypingIndicator />}
      </ChatMessageList>
    </ChatShell>
  );
}
```

- [ ] **Step 2: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/admin/assistant-panel.tsx
git commit -m "feat(ui): add AssistantPanel component for main assistant tab"
```

---

## Task 8: Add "Assistant" tab to AdminShell

**Files:**
- Modify: `components/admin/admin-shell.tsx`

- [ ] **Step 1: Import AssistantPanel**

Add at top of `components/admin/admin-shell.tsx`:
```ts
import { AssistantPanel } from '@/components/admin/assistant-panel';
```

- [ ] **Step 2: Add tab to type and tabs array**

Find:
```ts
type Tab = 'agents' | 'dashboard' | 'conversations' | 'listings' | 'config';
```
Replace with:
```ts
type Tab = 'agents' | 'dashboard' | 'conversations' | 'listings' | 'config' | 'assistant';
```

Find the `tabs` array:
```ts
  const tabs: { key: Tab; label: string }[] = [
    { key: 'agents', label: t.tab_agents },
    { key: 'dashboard', label: t.tab_dashboard },
    { key: 'conversations', label: t.tab_conversations },
    { key: 'listings', label: t.tab_listings },
    { key: 'config', label: t.tab_config }
  ];
```
Replace with:
```ts
  const tabs: { key: Tab; label: string }[] = [
    { key: 'agents', label: t.tab_agents },
    { key: 'dashboard', label: t.tab_dashboard },
    { key: 'conversations', label: t.tab_conversations },
    { key: 'listings', label: t.tab_listings },
    { key: 'config', label: t.tab_config },
    { key: 'assistant', label: t.tab_assistant }
  ];
```

- [ ] **Step 3: Add tab render**

After the last tab render line (`{tab === 'config' && <ConfigPanel ... />}`), add:
```tsx
{tab === 'assistant' && <AssistantPanel />}
```

- [ ] **Step 4: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add components/admin/admin-shell.tsx
git commit -m "feat(ui): add Assistant tab to admin shell"
```

---

## Task 9: Route admin Telegram to main_assistant

**Files:**
- Modify: `lib/telegram/handle-lead-telegram-update.ts`

- [ ] **Step 1: Update import**

Find:
```ts
import {
  consumeTelegramLink,
  consumeLeadTelegramLink
} from '@/lib/auth';
import {
  bindTelegramToAdmin,
  getAdminByTelegramUserId,
  getOrCreateAdminAssistant,
  ...
```
Replace `getOrCreateAdminAssistant` with `getOrCreateMainAssistant`:
```ts
import {
  bindTelegramToAdmin,
  getAdminByTelegramUserId,
  getOrCreateMainAssistant,
  ...
```

- [ ] **Step 2: Update handleAdminMessage**

Find:
```ts
async function handleAdminMessage(
  chatId: string,
  fromId: string,
  text: string
): Promise<boolean> {
  const admin = await getAdminByTelegramUserId(fromId);
  if (!admin) return false;

  const conv = await getOrCreateAdminAssistant(admin.id);
  await runAgentTurn(conv.id, text, {
    type: 'admin',
    adminId: admin.id,
    adminName: admin.name
  });
  return true;
}
```
Replace with:
```ts
async function handleAdminMessage(
  chatId: string,
  fromId: string,
  text: string
): Promise<boolean> {
  const admin = await getAdminByTelegramUserId(fromId);
  if (!admin) return false;

  const conv = await getOrCreateMainAssistant(admin.id);
  await runAgentTurn(conv.id, text, {
    type: 'main_assistant',
    adminId: admin.id,
    adminName: admin.name
  });
  return true;
}
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/telegram/handle-lead-telegram-update.ts
git commit -m "feat(telegram): route admin Telegram messages to main_assistant agent"
```

---

## Self-Review

**Spec coverage:**
- ✅ `main_assistant` ConversationType → Task 1
- ✅ `getOrCreateMainAssistant` DB function → Task 1
- ✅ All tools (leads, listings, calendar, analytics, subagent triggers) → Task 3
- ✅ System prompt with live snapshot → Task 4
- ✅ `main_assistant` actor in `run.ts` → Task 5
- ✅ API endpoint → Task 6
- ✅ UI AssistantPanel + tab → Tasks 7 & 8
- ✅ Telegram admin routing → Task 9

**Potential issue — circular import:**
`main-assistant-tools.ts` imports `runAgentTurn` from `lib/agent/run.ts`, and `run.ts` imports `buildMainAssistantTools` from `main-assistant-tools.ts`. This creates a circular dependency. Node.js handles most circular deps fine in practice (since the functions are resolved at call time, not import time), but if the compiler or runtime complains, the fix is: pass `runAgentTurn` as a parameter to `buildMainAssistantTools(ctx, adminId, adminName, runAgentTurn)` and update the Task 5 call site accordingly.

**Type check:** `listingSchema.partial().extend({ id: z.string() })` — verify `listingSchema` from `lib/types.ts` is a ZodObject (it is, from the schema definition). `.partial()` works on ZodObject. ✅
