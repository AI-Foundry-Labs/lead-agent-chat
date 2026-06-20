import { tool } from 'ai';
import { z } from 'zod';
import {
  getLeadById,
  getConversationByLeadId,
  createScheduledMessage,
  listScheduledMessages,
  cancelScheduledMessage,
  recordAudit
} from '@/lib/db';
import { parisLocalToUtc, utcToParisLabel } from '@/lib/scheduling/paris-time';
import type { AgentContext } from '@/lib/agent/tools/context';

// F4a — schedule a message to a lead for a future time. Delivery is handled by a
// background loop (RUN_SCHEDULER). Times are entered in Europe/Paris wall-clock.
export function buildScheduledMessagesTools(ctx: AgentContext, adminId: string) {
  const agencyId = ctx.config.agency_id;

  return {
    schedule_message: tool({
      description:
        'Schedule a message to be sent to a lead at a future time (Europe/Paris time). ' +
        'Use for timed follow-ups. Time format: "YYYY-MM-DD HH:MM" (24h, Paris local).',
      inputSchema: z.object({
        lead_id: z.string(),
        content: z.string().min(1).max(4000),
        send_at_local: z.string().describe('Paris local time, e.g. "2026-06-25 14:30"')
      }),
      execute: async ({ lead_id, content, send_at_local }) => {
        const lead = await getLeadById(lead_id);
        if (!lead || lead.agency_id !== agencyId) return { error: 'lead_not_found' };

        const sendAt = parisLocalToUtc(send_at_local);
        if (!sendAt) return { error: 'invalid_time_format', hint: 'use "YYYY-MM-DD HH:MM" (Paris)' };
        if (sendAt.getTime() <= Date.now()) return { error: 'send_at_must_be_future' };

        const conv = await getConversationByLeadId(lead_id);
        if (!conv) return { error: 'conversation_not_found' };

        const row = await createScheduledMessage({
          agency_id: agencyId,
          conversation_id: conv.id,
          lead_id,
          content,
          send_at: sendAt,
          created_by: adminId
        });
        await recordAudit({
          agency_id: agencyId,
          admin_id: adminId,
          action: 'scheduled_message_created',
          target_lead_id: lead_id,
          details: { scheduled_id: row.id, send_at: sendAt.toISOString() }
        });
        return { ok: true, id: row.id, send_at_paris: utcToParisLabel(sendAt) };
      }
    }),

    list_scheduled_messages: tool({
      description: 'List scheduled messages for the agency, or for one lead. Shows status and Paris send time.',
      inputSchema: z.object({ lead_id: z.string().optional() }),
      execute: async ({ lead_id }) => {
        const rows = await listScheduledMessages(agencyId, lead_id);
        return rows.map((r) => ({
          id: r.id,
          lead_id: r.lead_id,
          status: r.status,
          send_at_paris: utcToParisLabel(r.send_at),
          content: r.content.slice(0, 200),
          sent_at: r.sent_at,
          error: r.error
        }));
      }
    }),

    cancel_scheduled_message: tool({
      description: 'Cancel a still-pending scheduled message by id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const ok = await cancelScheduledMessage(agencyId, id);
        return ok ? { ok: true } : { error: 'not_found_or_not_pending' };
      }
    })
  };
}
