/**
 * Operator lead-management tools — status/potential, qualification, memory, viewings, escalation.
 * Each tool acts on a specific lead: defaults to the operator's scoped lead, or an explicit
 * lead_id (used in pool mode where the operator triages multiple anonymous visitors).
 */
import { tool } from 'ai';
import { z } from 'zod';
import { getLeadById, updateLead, listBookedViewings } from '@/lib/db';
import { isIdentifiedLead } from '@/lib/leads/is-identified-lead';
import { notifyAdmins } from '@/lib/notify';
import { formatSlot } from '@/lib/format';
import { scheduleAppendLeadLongTermFacts } from '@/lib/agent/append-lead-long-term-facts';
import { cancelViewingWithMemory, rescheduleViewingWithMemory } from '@/lib/agent/viewing-actions';
import type { AgentContext } from './context';

export function buildOperatorLeadActions(ctx: AgentContext, scopedLeadId: string | null) {
  const resolveLeadId = (argLeadId?: string) => argLeadId ?? scopedLeadId ?? null;

  return {
    update_lead_status: tool({
      description:
        'Update a lead\'s potential (hot/warm/cold) and/or lifecycle status. ' +
        'Potential works on any visitor (incl. anonymous) for triage. ' +
        'Lifecycle status (qualified/booked/handoff/abandoned) requires an identified lead (email/name). ' +
        'Always pass memory_note so the reason is persisted.',
      inputSchema: z.object({
        lead_id: z.string().optional().describe('Defaults to the operator\'s scoped lead'),
        potential_status: z.enum(['hot', 'warm', 'cold']).optional(),
        status: z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
        memory_note: z.string().max(600).optional().describe('Reason for the change — stored in lead memory')
      }),
      execute: async ({ lead_id, potential_status, status, memory_note }) => {
        const id = resolveLeadId(lead_id);
        if (!id) return { error: 'no_lead_in_scope' };
        const lead = await getLeadById(id);
        if (!lead) return { error: 'lead_not_found' };

        // Lifecycle status only applies to identified leads; potential is always allowed.
        let appliedStatus = status;
        let statusBlocked = false;
        if (status && !isIdentifiedLead(lead)) {
          appliedStatus = undefined;
          statusBlocked = true;
        }
        const updated = await updateLead(id, {
          ...(potential_status !== undefined && { potential_status }),
          ...(appliedStatus !== undefined && { status: appliedStatus })
        });
        if (memory_note || potential_status || appliedStatus) {
          const date = new Date().toISOString().slice(0, 10);
          const parts = [
            appliedStatus ? `status→${appliedStatus}` : '',
            potential_status ? `potential→${potential_status}` : ''
          ].filter(Boolean).join(' ');
          scheduleAppendLeadLongTermFacts(id, [
            `PURCHASE STATUS — ${date}: ${parts}. ${memory_note ?? ''}`.trim()
          ]);
        }
        return {
          ok: true,
          id: updated.id,
          status: updated.status,
          potential_status: updated.potential_status,
          ...(statusBlocked && { status_blocked: 'lead not identified — lifecycle status unchanged' })
        };
      }
    }),

    record_qualification: tool({
      description:
        'Persist qualification values, a computed potential, and a one-line reason for a lead.',
      inputSchema: z.object({
        lead_id: z.string().optional().describe('Defaults to the operator\'s scoped lead'),
        values: z.record(z.string(), z.string()).describe('criterionKey → value'),
        potential_status: z.enum(['hot', 'warm', 'cold']),
        reason: z.string().max(200)
      }),
      execute: async ({ lead_id, values, potential_status, reason }) => {
        const id = resolveLeadId(lead_id);
        if (!id) return { error: 'no_lead_in_scope' };
        const lead = await getLeadById(id);
        if (!lead) return { error: 'lead_not_found' };
        const merged = { ...lead.qual_values, ...values };
        const allKeys = ctx.config.qualification_criteria.map((c) => c.key);
        const complete = allKeys.every((k) => merged[k]);
        const updated = await updateLead(id, {
          qual_values: merged,
          potential_status,
          score_reason: reason,
          status: complete && isIdentifiedLead(lead) ? 'qualified' : lead.status
        });
        const factLines = Object.entries(values).map(([k, v]) => {
          const label = ctx.config.qualification_criteria.find((c) => c.key === k)?.label ?? k;
          return `${label}: ${v}`;
        });
        scheduleAppendLeadLongTermFacts(id, [...factLines, `potential: ${potential_status}`], reason);
        return { ok: true, qual_values: updated.qual_values, potential_status, all_criteria_collected: complete };
      }
    }),

    remember_visitor_fact: tool({
      description:
        'Persist durable facts for a lead: identity, product preferences, purchase status, objections, admin actions.',
      inputSchema: z.object({
        lead_id: z.string().optional().describe('Defaults to the operator\'s scoped lead'),
        facts: z.array(z.string().max(800)).min(1).max(20)
      }),
      execute: async ({ lead_id, facts }) => {
        const id = resolveLeadId(lead_id);
        if (!id) return { error: 'no_lead_in_scope' };
        scheduleAppendLeadLongTermFacts(id, facts);
        return { ok: true, stored: facts.length };
      }
    }),

    get_lead_viewings: tool({
      description: 'List all viewings for a lead.',
      inputSchema: z.object({ lead_id: z.string().optional() }),
      execute: async ({ lead_id }) => {
        const id = resolveLeadId(lead_id);
        if (!id) return { error: 'no_lead_in_scope' };
        const all = await listBookedViewings(ctx.config.agency_id);
        return all
          .filter((v) => v.lead_id === id)
          .map((v) => ({
            id: v.id,
            listing_id: v.listing_id,
            slot: v.confirmed_slot ? formatSlot(v.confirmed_slot.toISOString()) : null,
            status: v.status,
            calendar_event_id: v.calendar_event_id
          }));
      }
    }),

    cancel_viewing: tool({
      description: 'Cancel a booked viewing and delete its calendar event (records reason in lead memory).',
      inputSchema: z.object({
        viewing_id: z.string(),
        reason: z.string().max(300).optional()
      }),
      execute: async ({ viewing_id, reason }) =>
        cancelViewingWithMemory(viewing_id, ctx.config.calendar_id, reason)
    }),

    reschedule_viewing: tool({
      description: 'Reschedule a booked viewing to a new slot.',
      inputSchema: z.object({ viewing_id: z.string(), new_slot_iso: z.string() }),
      execute: async ({ viewing_id, new_slot_iso }) =>
        rescheduleViewingWithMemory(viewing_id, new_slot_iso, ctx.config.calendar_id)
    }),

    request_handoff: tool({
      description:
        'Escalate a lead for human follow-up: marks status=handoff and alerts admins. Use for negotiation, complaints, or sensitive topics.',
      inputSchema: z.object({
        lead_id: z.string().optional().describe('Defaults to the operator\'s scoped lead'),
        reason: z.string().max(300)
      }),
      execute: async ({ lead_id, reason }) => {
        const id = resolveLeadId(lead_id);
        if (!id) return { error: 'no_lead_in_scope' };
        const lead = await getLeadById(id);
        if (!lead) return { error: 'lead_not_found' };
        if (isIdentifiedLead(lead)) {
          await updateLead(id, { status: 'handoff' });
        }
        await notifyAdmins(`[Handoff requested] ${reason}`);
        const date = new Date().toISOString().slice(0, 10);
        scheduleAppendLeadLongTermFacts(id, [`ADMIN ACTION — ${date}: handoff requested — ${reason}`]);
        return { ok: true, handed_off: true };
      }
    }),

    notify_admin: tool({
      description: 'Send a short notification to the agency admins.',
      inputSchema: z.object({ summary: z.string().max(280) }),
      execute: async ({ summary }) => {
        await notifyAdmins(summary);
        return { ok: true };
      }
    })
  };
}
