import { tool } from 'ai';
import { z } from 'zod';
import { ilike, or } from 'drizzle-orm';
import { scheduleAppendLeadLongTermFacts } from '@/lib/agent/append-lead-long-term-facts';
import {
  listLeads,
  getLeadById,
  getConversationByLeadId,
  getVisibleMessages,
  updateLead,
  listConversationsByLeadId,
  listViewingsByLead,
  recordAudit,
  db,
  leads
} from '@/lib/db';
import { formatSlot } from '@/lib/format';
import { broadcastAgencyDataChanged } from '@/lib/events';
import type { AgentContext } from '@/lib/agent/tools/context';

export function buildLeadsTools(ctx: AgentContext, adminId: string) {
  const agencyId = ctx.config.agency_id;
  return {
    query_leads: tool({
      description: 'List/filter leads by status, potential, listing, or recency.',
      inputSchema: z.object({
        status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
        potential: z.enum(['hot', 'warm', 'cold']).optional(),
        listing_id: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional()
      }),
      execute: async ({ status, potential, listing_id, limit }) => {
        let all = await listLeads(ctx.config.agency_id);
        if (status) all = all.filter((l) => l.status === status);
        if (potential) all = all.filter((l) => l.potential_status === potential);
        if (listing_id) all = all.filter((l) => l.listing_id === listing_id);
        return all.slice(0, limit ?? 20).map((l) => ({
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

    search_leads: tool({
      description: 'Search leads by name or email (partial match, case-insensitive).',
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      execute: async ({ query }) => {
        const q = `%${query}%`;
        const rows = await db
          .select({
            id: leads.id,
            email: leads.email,
            name: leads.name,
            status: leads.status,
            potential_status: leads.potential_status,
            score_reason: leads.score_reason,
            updated_at: leads.updated_at
          })
          .from(leads)
          .where(or(ilike(leads.email, q), ilike(leads.name, q)))
          .limit(20);
        return rows;
      }
    }),

    get_lead_detail: tool({
      description: "Read a lead's full profile, qualification state, and conversation messages.",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const lead = await getLeadById(lead_id);
        if (!lead || lead.agency_id !== agencyId) return { error: 'lead_not_found' };
        const conv = await getConversationByLeadId(lead_id);
        const msgs = conv ? await getVisibleMessages(conv.id) : [];
        await recordAudit({ agency_id: agencyId, admin_id: adminId, action: 'lead_viewed', target_lead_id: lead_id });
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
          messages: msgs.slice(-20).map((m) => ({ role: m.role, content: m.content }))
        };
      }
    }),

    update_lead_info: tool({
      description:
        'Update a lead\'s profile fields and/or system status. ' +
        'Use proactively when you learn significant facts: lead says they won\'t buy → status=abandoned; ' +
        'lead confirms purchase → status=qualified or booked; lead needs human → status=handoff. ' +
        'Always pass memory_note when changing status so the reason is persisted.',
      inputSchema: z.object({
        lead_id: z.string(),
        name: z.string().max(255).optional(),
        email: z.string().email().optional(),
        status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned'])
          .optional()
          .describe('New lifecycle status — set abandoned when lead confirms they will not purchase'),
        potential_status: z.enum(['hot', 'warm', 'cold'])
          .optional()
          .describe('New potential tier — update when intent clearly changes'),
        memory_note: z.string().max(600)
          .optional()
          .describe('Reason for the change — stored in lead long-term memory')
      }),
      execute: async ({ lead_id, name, email, status, potential_status, memory_note }) => {
        const lead = await getLeadById(lead_id);
        if (!lead || lead.agency_id !== agencyId) return { error: 'lead_not_found' };
        const updated = await updateLead(lead_id, {
          ...(name !== undefined && { name }),
          ...(email !== undefined && { email }),
          ...(status !== undefined && { status }),
          ...(potential_status !== undefined && { potential_status })
        });
        if (memory_note) {
          const date = new Date().toISOString().slice(0, 10);
          const statusNote = status ? `status→${status}` : '';
          const potentialNote = potential_status ? ` potential→${potential_status}` : '';
          scheduleAppendLeadLongTermFacts(lead_id, [
            `PURCHASE STATUS — ${date}: ${statusNote}${potentialNote}. ${memory_note}`
          ]);
        }
        await recordAudit({
          agency_id: agencyId,
          admin_id: adminId,
          action: 'lead_updated',
          target_lead_id: lead_id,
          details: { status, potential_status }
        });
        return {
          ok: true,
          id: updated.id,
          name: updated.name,
          email: updated.email,
          status: updated.status,
          potential_status: updated.potential_status
        };
      }
    }),

    delete_lead: tool({
      description:
        'Permanently hard-delete a lead and all their conversations. ' +
        'DESTRUCTIVE — requires confirm:true. Use only on explicit admin instruction.',
      inputSchema: z.object({
        lead_id: z.string(),
        confirm: z.boolean().describe('Must be true to execute the deletion')
      }),
      execute: async ({ lead_id, confirm }) => {
        if (!confirm) return { error: 'confirmation_required', hint: 'pass confirm:true to execute' };
        const lead = await getLeadById(lead_id);
        if (!lead || lead.agency_id !== agencyId) return { error: 'lead_not_found' };
        // Emit the erasure audit BEFORE deletion. No PII in details (CNIL: no trace);
        // target_lead_id has no FK so this row survives the lead's removal.
        await recordAudit({ agency_id: agencyId, admin_id: adminId, action: 'lead_erasure_executed', target_lead_id: lead_id });
        // Import lazily to avoid circular deps at module load time
        const { closeLeadTopics } = await import('@/lib/db');
        await closeLeadTopics(lead_id).catch(() => {});
        const { deleteConversationsByLeadId } = await import('@/lib/db');
        await deleteConversationsByLeadId(lead_id);
        const { deleteLead } = await import('@/lib/db');
        await deleteLead(lead_id);
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, deleted: lead_id };
      }
    }),

    record_qualification: tool({
      description:
        'Update qualification values and potential for a specific lead. ' +
        'Use when admin learns new info about a lead (phone call, email, meeting) that was not captured in chat.',
      inputSchema: z.object({
        lead_id: z.string(),
        values: z.record(z.string(), z.string()).describe('criterionKey → value, e.g. { budget: "800k€" }'),
        potential_status: z.enum(['hot', 'warm', 'cold']),
        reason: z.string().max(200)
      }),
      execute: async ({ lead_id, values, potential_status, reason }) => {
        const lead = await getLeadById(lead_id);
        if (!lead || lead.agency_id !== agencyId) return { error: 'lead_not_found' };
        const merged = { ...lead.qual_values, ...values };
        const allKeys = ctx.config.qualification_criteria.map((c) => c.key);
        const complete = allKeys.every((k) => merged[k]);
        const updated = await updateLead(lead_id, {
          qual_values: merged,
          potential_status,
          score_reason: reason,
          status: complete && lead.status === 'active' ? 'qualified' : lead.status
        });
        const factLines = Object.entries(values).map(([k, v]) => {
          const label = ctx.config.qualification_criteria.find((c) => c.key === k)?.label ?? k;
          return `${label}: ${v}`;
        });
        scheduleAppendLeadLongTermFacts(lead_id, [...factLines, `potential: ${potential_status}`], reason);
        await recordAudit({ agency_id: agencyId, admin_id: adminId, action: 'lead_qualified', target_lead_id: lead_id, details: { potential_status } });
        return { ok: true, qual_values: updated.qual_values, potential_status, all_criteria_collected: complete };
      }
    }),

    remember_visitor_fact: tool({
      description:
        'Append durable facts to a lead\'s long-term memory. ' +
        'Use when admin learns info outside chat (phone call, email, in-person meeting).',
      inputSchema: z.object({
        lead_id: z.string(),
        facts: z.array(z.string().max(800)).min(1).max(20)
          .describe('Factual bullets to persist, e.g. "Budget confirmed: 750k€"')
      }),
      execute: async ({ lead_id, facts }) => {
        const lead = await getLeadById(lead_id);
        if (!lead || lead.agency_id !== agencyId) return { error: 'lead_not_found' };
        const date = new Date().toISOString().slice(0, 10);
        const tagged = facts.map((f) => f.includes('[') ? f : `[admin · ${date}] ${f}`);
        scheduleAppendLeadLongTermFacts(lead_id, tagged);
        await recordAudit({ agency_id: agencyId, admin_id: adminId, action: 'lead_fact_added', target_lead_id: lead_id });
        return { ok: true, stored: tagged.length };
      }
    }),

    get_lead_threads: tool({
      description: 'List all conversation threads for a lead (web, Telegram, operator, etc.).',
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const threads = await listConversationsByLeadId(lead_id);
        return threads.map((t) => ({
          conversation_id: t.id,
          type: t.type,
          channel: t.primary_channel,
          mode: t.mode,
          listing_id: t.listing_id,
          thread_summary: t.thread_summary?.slice(0, 200),
          updated_at: t.updated_at
        }));
      }
    }),

    get_lead_viewings: tool({
      description: 'List all viewings (all statuses) for a specific lead.',
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const viewings = await listViewingsByLead(lead_id);
        return viewings.map((v) => ({
          id: v.id,
          listing_id: v.listing_id,
          contact_email: v.contact_email,
          slot: v.confirmed_slot ? formatSlot(v.confirmed_slot.toISOString()) : null,
          status: v.status,
          calendar_event_id: v.calendar_event_id
        }));
      }
    })
  };
}
