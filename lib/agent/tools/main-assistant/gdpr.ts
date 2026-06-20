import { tool } from 'ai';
import { z } from 'zod';
import {
  getLeadById,
  listConversationsByLeadId,
  getVisibleMessages,
  listViewingsByLead,
  setConsent,
  getLatestConsents,
  listAuditByLead,
  recordAudit
} from '@/lib/db';
import type { AgentContext } from '@/lib/agent/tools/context';

// F4d — GDPR/CNIL: per-lead consent, audit trail, and Art.15 data export.
// All agency-scoped. Erasure is handled by the existing delete_lead tool.
export function buildGdprTools(ctx: AgentContext, adminId: string) {
  const agencyId = ctx.config.agency_id;

  // Shared agency guard for a lead id.
  const assertLead = async (leadId: string) => {
    const lead = await getLeadById(leadId);
    return lead && lead.agency_id === agencyId ? lead : null;
  };

  return {
    set_consent: tool({
      description:
        'Record a lead\'s data-processing consent (grant or withdrawal). Append-only — each call ' +
        'adds a history row. Use when a lead consents/opts-out by phone, email, or form.',
      inputSchema: z.object({
        lead_id: z.string(),
        consent_type: z.enum(['data_processing', 'marketing', 'phone_contact']),
        granted: z.boolean(),
        source: z.string().max(50).optional().describe('e.g. phone, web_form, email'),
        notes: z.string().max(500).optional()
      }),
      execute: async ({ lead_id, consent_type, granted, source, notes }) => {
        if (!(await assertLead(lead_id))) return { error: 'lead_not_found' };
        await setConsent({
          agency_id: agencyId,
          lead_id,
          consent_type,
          granted,
          source,
          notes,
          recorded_by: adminId
        });
        await recordAudit({
          agency_id: agencyId,
          admin_id: adminId,
          action: 'consent_set',
          target_lead_id: lead_id,
          details: { consent_type, granted }
        });
        return { ok: true };
      }
    }),

    view_consent_status: tool({
      description: 'View a lead\'s current consent state (latest grant/withdrawal per consent type).',
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        if (!(await assertLead(lead_id))) return { error: 'lead_not_found' };
        return { consents: await getLatestConsents(agencyId, lead_id) };
      }
    }),

    view_audit_history: tool({
      description: 'View the audit trail for a lead — who accessed/modified it and when.',
      inputSchema: z.object({
        lead_id: z.string(),
        limit: z.number().int().min(1).max(100).optional()
      }),
      execute: async ({ lead_id, limit }) => {
        if (!(await assertLead(lead_id))) return { error: 'lead_not_found' };
        const rows = await listAuditByLead(agencyId, lead_id, limit ?? 50);
        return rows.map((r) => ({
          action: r.action,
          actor_type: r.actor_type,
          admin_id: r.admin_id,
          details: r.details,
          at: r.timestamp
        }));
      }
    }),

    export_lead_data: tool({
      description:
        'Export ALL data held on a lead as one JSON bundle (GDPR Art.15 right of access): ' +
        'profile, consents, viewings, and every conversation message.',
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        const lead = await assertLead(lead_id);
        if (!lead) return { error: 'lead_not_found' };

        const convs = await listConversationsByLeadId(lead_id);
        const conversations = [];
        for (const c of convs) {
          const msgs = await getVisibleMessages(c.id);
          conversations.push({
            conversation_id: c.id,
            channel: c.primary_channel,
            messages: msgs.map((m) => ({ role: m.role, content: m.content, at: m.timestamp }))
          });
        }
        const [consents, viewings] = await Promise.all([
          getLatestConsents(agencyId, lead_id),
          listViewingsByLead(lead_id)
        ]);

        await recordAudit({
          agency_id: agencyId,
          admin_id: adminId,
          action: 'lead_data_exported',
          target_lead_id: lead_id
        });

        return {
          profile: {
            id: lead.id,
            name: lead.name,
            email: lead.email,
            status: lead.status,
            potential_status: lead.potential_status,
            qual_values: lead.qual_values,
            persona: lead.persona,
            long_term_memory: lead.long_term_memory,
            created_at: lead.created_at
          },
          consents,
          viewings,
          conversations
        };
      }
    })
  };
}
