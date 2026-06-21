import { tool } from 'ai';
import { z } from 'zod';
import { listLeads, getAgencyById, closeLeadTopics } from '@/lib/db';
import { sendTelegramMessage } from '@/lib/telegram';
import { issueAgencyTelegramLinkToken } from '@/lib/auth';
import type { AgentContext } from '@/lib/agent/tools/context';

export function buildTelegramTools(ctx: AgentContext) {
  return {
    telegram_broadcast: tool({
      description:
        'Send a message to all leads who have Telegram linked. Optionally filter by potential status or listing.',
      inputSchema: z.object({
        message: z.string().min(1).max(1000),
        potential: z.enum(['hot', 'warm', 'cold']).optional(),
        listing_id: z.string().optional()
      }),
      execute: async ({ message, potential, listing_id }) => {
        let allLeads = await listLeads(ctx.config.agency_id);
        allLeads = allLeads.filter((l) => !!l.telegram_user_id);
        if (potential) allLeads = allLeads.filter((l) => l.potential_status === potential);
        if (listing_id) allLeads = allLeads.filter((l) => l.listing_id === listing_id);

        const results: { lead_id: string; name: string | null; sent: boolean }[] = [];
        for (const lead of allLeads) {
          try {
            await sendTelegramMessage(lead.telegram_user_id!, message);
            results.push({ lead_id: lead.id, name: lead.name, sent: true });
          } catch {
            results.push({ lead_id: lead.id, name: lead.name, sent: false });
          }
        }
        const sent = results.filter((r) => r.sent).length;
        return { total_sent: sent, failed: results.length - sent, details: results };
      }
    }),

    get_telegram_status: tool({
      description: 'Check whether a Telegram group is linked to the agency and how many leads have Telegram connected.',
      inputSchema: z.object({}),
      execute: async () => {
        const agency = await getAgencyById(ctx.config.agency_id);
        if (!agency) return { error: 'agency_not_found' };
        const allLeads = await listLeads(ctx.config.agency_id);
        const leads_linked_count = allLeads.filter((l) => !!l.telegram_user_id).length;
        return {
          group_linked: !!agency.telegram_group_chat_id,
          telegram_group_chat_id: agency.telegram_group_chat_id,
          telegram_master_topic_id: agency.telegram_master_topic_id,
          leads_linked_count
        };
      }
    }),

    issue_telegram_link_token: tool({
      description:
        'Issue a single-use agency Telegram link token (10 min TTL). ' +
        'Returns the /link command to paste inside the Telegram supergroup to bind it.',
      inputSchema: z.object({}),
      execute: async () => {
        const token = await issueAgencyTelegramLinkToken(ctx.config.agency_id);
        return {
          token,
          command: `/link ${token}`,
          instructions: [
            '1. Créez un supergroupe Telegram et activez les Sujets (Paramètres → Sujets).',
            '2. Ajoutez le bot comme administrateur avec la permission « Gérer les sujets ».',
            '3. Envoyez la commande ci-dessus DANS ce groupe (pas en message privé).',
            '---',
            '1. Create a Telegram supergroup and enable Topics (Settings → Topics).',
            '2. Add the bot as admin with "Manage Topics" permission.',
            '3. Send the command above INSIDE that group (not as a private message).'
          ]
        };
      }
    }),

    close_lead_telegram_topics: tool({
      description: "Close the Telegram forum topics for a lead (marks them as closed in the agency group).",
      inputSchema: z.object({ lead_id: z.string() }),
      execute: async ({ lead_id }) => {
        await closeLeadTopics(lead_id);
        return { ok: true };
      }
    })
  };
}
