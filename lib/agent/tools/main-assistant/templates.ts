import { tool } from 'ai';
import { z } from 'zod';
import {
  listMessageTemplates,
  getMessageTemplate,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
  getLeadById,
  getListing
} from '@/lib/db';
import { renderTemplate } from '@/lib/agent/templates/render-template';
import type { AgentContext } from '@/lib/agent/tools/context';

// F4b — reusable, agency-scoped message templates. Rendering only FILLS text;
// sending stays the job of send_reply / draft_reply (agent chains them).
export function buildTemplatesTools(ctx: AgentContext) {
  const agencyId = ctx.config.agency_id;

  return {
    list_templates: tool({
      description: 'List the agency\'s reusable message templates (id, title, body).',
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await listMessageTemplates(agencyId);
        return rows.map((t) => ({ id: t.id, title: t.title, body: t.body }));
      }
    }),

    get_template: tool({
      description: 'Fetch one message template by id.',
      inputSchema: z.object({ template_id: z.string() }),
      execute: async ({ template_id }) => {
        const t = await getMessageTemplate(agencyId, template_id);
        if (!t) return { error: 'template_not_found' };
        return { id: t.id, title: t.title, body: t.body };
      }
    }),

    create_template: tool({
      description:
        'Create a reusable message template. Body may contain placeholders: ' +
        '{{name}}, {{email}}, {{listing_title}}, {{agency_name}}.',
      inputSchema: z.object({
        title: z.string().min(1).max(255),
        body: z.string().min(1).max(4000)
      }),
      execute: async ({ title, body }) => {
        const t = await createMessageTemplate({ agency_id: agencyId, title, body });
        return { ok: true, id: t.id };
      }
    }),

    update_template: tool({
      description: 'Update a template\'s title and/or body.',
      inputSchema: z.object({
        template_id: z.string(),
        title: z.string().min(1).max(255).optional(),
        body: z.string().min(1).max(4000).optional()
      }),
      execute: async ({ template_id, title, body }) => {
        if (title === undefined && body === undefined)
          return { error: 'nothing_to_update' };
        const t = await updateMessageTemplate(agencyId, template_id, { title, body });
        if (!t) return { error: 'template_not_found' };
        return { ok: true, id: t.id };
      }
    }),

    delete_template: tool({
      description: 'Permanently delete a message template.',
      inputSchema: z.object({ template_id: z.string() }),
      execute: async ({ template_id }) => {
        const ok = await deleteMessageTemplate(agencyId, template_id);
        return ok ? { ok: true } : { error: 'template_not_found' };
      }
    }),

    render_template: tool({
      description:
        'Fill a template\'s placeholders from a lead\'s data and return the text. ' +
        'Does NOT send — pass the rendered text to send_reply or draft_reply. ' +
        'Returns unresolved placeholders (left literal) so you can fix them.',
      inputSchema: z.object({
        template_id: z.string(),
        lead_id: z.string().optional().describe('Lead whose data fills the placeholders')
      }),
      execute: async ({ template_id, lead_id }) => {
        const t = await getMessageTemplate(agencyId, template_id);
        if (!t) return { error: 'template_not_found' };

        const lead = lead_id ? await getLeadById(lead_id) : null;
        if (lead_id && (!lead || lead.agency_id !== agencyId))
          return { error: 'lead_not_found' };

        const listing = lead?.listing_id ? await getListing(lead.listing_id) : null;
        const listingTitle = listing
          ? ctx.lang === 'en'
            ? listing.title_en
            : listing.title
          : undefined;

        const { rendered, unresolved } = renderTemplate(t.body, {
          name: lead?.name,
          email: lead?.email,
          listing_title: listingTitle,
          agency_name: ctx.config.name
        });
        return { rendered, unresolved };
      }
    })
  };
}
