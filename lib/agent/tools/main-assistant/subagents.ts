import { tool } from 'ai';
import { z } from 'zod';
import {
  listLeads,
  getLeadById,
  getConversationByLeadId,
  getOrCreateLeadOperator,
  addMessage
} from '@/lib/db';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import { notifyAdmins } from '@/lib/notify';
import type { AgentContext } from '@/lib/agent/tools/context';
import type { RunAgentTurn } from './types';

export function buildSubagentsTools(
  ctx: AgentContext,
  adminId: string,
  adminName: string | null,
  runAgentTurn: RunAgentTurn
) {
  return {
    trigger_operator_briefing: tool({
      description:
        'Run the lead operator agent for a specific lead and return a full briefing. Use before advising on complex leads.',
      inputSchema: z.object({
        lead_id: z.string(),
        question: z.string().max(400).optional()
      }),
      execute: async ({ lead_id, question }) => {
        const lead = await getLeadById(lead_id);
        if (!lead) return { error: 'lead_not_found' };
        const operatorConv = await getOrCreateLeadOperator(lead_id, ctx.config.agency_id);
        const prompt = question
          ? `${question} Please review this lead's full profile and give a concise briefing.`
          : `Please review this lead's full profile and conversation history. Give me a concise briefing: who they are, what they want, their qualification status, and recommended next action.`;
        const result = await runAgentTurn(operatorConv.id, prompt, {
          type: 'operator',
          leadId: lead_id,
          adminId,
          adminName
        });
        return { ok: true, briefing: result.reply };
      }
    }),

    bulk_follow_up: tool({
      description:
        'Send a follow-up message to all hot/warm leads whose last conversation activity exceeds a given number of days. Returns list of leads messaged.',
      inputSchema: z.object({
        message: z.string().min(1).max(1000).describe('Message to send to each lead'),
        potential: z.enum(['hot', 'warm']).optional().describe('Filter by potential — omit for both'),
        inactive_days: z.number().int().min(1).max(90).default(7).describe('Minimum days since last activity')
      }),
      execute: async ({ message, potential, inactive_days }) => {
        const cutoff = new Date(Date.now() - inactive_days * 24 * 60 * 60 * 1000);
        let allLeads = await listLeads(ctx.config.agency_id);
        if (potential) allLeads = allLeads.filter((l) => l.potential_status === potential);
        else allLeads = allLeads.filter((l) => l.potential_status === 'hot' || l.potential_status === 'warm');
        allLeads = allLeads.filter((l) => l.status === 'active' || l.status === 'qualified');

        const results: { lead_id: string; email: string | null; name: string | null; sent: boolean; reason?: string }[] = [];
        for (const lead of allLeads) {
          const conv = await getConversationByLeadId(lead.id);
          if (!conv) {
            results.push({ lead_id: lead.id, email: lead.email, name: lead.name, sent: false, reason: 'no_conversation' });
            continue;
          }
          const lastActivity = conv.updated_at ? new Date(conv.updated_at) : null;
          if (lastActivity && lastActivity >= cutoff) {
            results.push({ lead_id: lead.id, email: lead.email, name: lead.name, sent: false, reason: 'recently_active' });
            continue;
          }
          await addMessage({ conversation_id: conv.id, role: 'admin', content: message });
          await dispatchReply(conv, message);
          broadcastConversationUpdate(conv.id);
          results.push({ lead_id: lead.id, email: lead.email, name: lead.name, sent: true });
        }
        const sent = results.filter((r) => r.sent).length;
        return { total_contacted: sent, skipped: results.length - sent, details: results };
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
