import { tool } from 'ai';
import { z } from 'zod';
import { listLeads, listBookedViewings } from '@/lib/db';
import type { AgentContext } from '@/lib/agent/tools/context';

export function buildAnalyticsTools(ctx: AgentContext) {
  return {
    pipeline_summary: tool({
      description: 'Get lead pipeline counts by status and potential.',
      inputSchema: z.object({}),
      execute: async () => {
        const allLeads = await listLeads(ctx.config.agency_id);
        const byStatus = allLeads.reduce<Record<string, number>>((acc, l) => {
          acc[l.status ?? 'unknown'] = (acc[l.status ?? 'unknown'] ?? 0) + 1;
          return acc;
        }, {});
        const byPotential = allLeads.reduce<Record<string, number>>((acc, l) => {
          const k = l.potential_status ?? 'unscored';
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {});
        const booked = allLeads.filter((l) => l.status === 'booked').length;
        const total = allLeads.length;
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
        const allLeads = await listLeads(ctx.config.agency_id);
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recent = allLeads.filter((l) => l.created_at && new Date(l.created_at) >= cutoff);
        const viewings = await listBookedViewings(ctx.config.agency_id);
        const recentViewings = viewings.filter(
          (v) => v.created_at && new Date(v.created_at) >= cutoff
        );
        return {
          new_leads: recent.length,
          new_bookings: recentViewings.length,
          handoffs: recent.filter((l) => l.status === 'handoff').length,
          hot_leads: allLeads.filter((l) => l.potential_status === 'hot').length
        };
      }
    })
  };
}
