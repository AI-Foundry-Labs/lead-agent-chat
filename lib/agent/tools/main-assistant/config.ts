import { tool } from 'ai';
import { z } from 'zod';
import {
  updateCriteria,
  upsertAgencyConfig,
  listHandoffRules,
  createHandoffRule,
  toggleHandoffRule,
  deleteHandoffRule
} from '@/lib/db';
import { broadcastAgencyDataChanged } from '@/lib/events';
import { criterionSchema } from '@/lib/types';
import type { AgentContext } from '@/lib/agent/tools/context';

export function buildConfigTools(ctx: AgentContext) {
  return {
    get_config: tool({
      description: 'Read current agency configuration: name, tone, qualification criteria, calendar_id, agency_id.',
      inputSchema: z.object({}),
      execute: async () => ({
        name: ctx.config.name,
        tone: ctx.config.tone,
        qualification_criteria: ctx.config.qualification_criteria,
        calendar_id: ctx.config.calendar_id,
        agency_id: ctx.config.agency_id
      })
    }),

    update_config: tool({
      description: 'Adjust agency name and/or tone. Use get_config first to read current values.',
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
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, name: ctx.config.name };
      }
    }),

    update_criteria: tool({
      description:
        'REPLACE ALL qualification criteria with the provided array. ' +
        'WARNING: this overwrites every existing criterion — you will lose any you omit. ' +
        'Use add_criterion / remove_criterion for incremental changes instead. ' +
        'Only use this tool when you intend to set the full list at once.',
      inputSchema: z.object({ criteria: z.array(criterionSchema).min(1) }),
      execute: async ({ criteria }) => {
        ctx.config = await updateCriteria(ctx.config.agency_id, criteria);
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, criteria: ctx.config.qualification_criteria };
      }
    }),

    add_criterion: tool({
      description:
        'Add a single qualification criterion without touching existing ones. ' +
        'Reads current criteria, appends the new one, and persists. ' +
        'Returns error if a criterion with the same key already exists.',
      inputSchema: z.object({
        key: z.string().min(1).max(64).describe('Unique identifier, e.g. "budget"'),
        label: z.string().min(1).max(255).describe('Human-readable label, e.g. "Budget"'),
        hint: z.string().max(500).optional().describe('Optional hint shown to the agent')
      }),
      execute: async ({ key, label, hint }) => {
        const current = ctx.config.qualification_criteria;
        if (current.some((c) => c.key === key)) return { error: 'duplicate_key' };
        const next = [...current, { key, label, ...(hint && { hint }) }];
        ctx.config = await updateCriteria(ctx.config.agency_id, next);
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, criteria: ctx.config.qualification_criteria };
      }
    }),

    remove_criterion: tool({
      description:
        'Remove a single qualification criterion by key without touching others. ' +
        'Returns error if key not found or if removing it would leave zero criteria.',
      inputSchema: z.object({
        key: z.string().min(1).max(64).describe('Key of the criterion to remove')
      }),
      execute: async ({ key }) => {
        const current = ctx.config.qualification_criteria;
        const next = current.filter((c) => c.key !== key);
        if (next.length === current.length) return { error: 'not_found' };
        if (next.length === 0) return { error: 'cannot_remove_last' };
        ctx.config = await updateCriteria(ctx.config.agency_id, next);
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, criteria: ctx.config.qualification_criteria };
      }
    }),

    list_handoff_rules: tool({
      description: 'List all handoff/escalation rules (active and inactive).',
      inputSchema: z.object({}),
      execute: async () => {
        const rules = await listHandoffRules(ctx.config.agency_id);
        return rules.map((r) => ({
          id: r.id,
          description: r.description,
          trigger_keywords: r.trigger_keywords,
          active: r.active
        }));
      }
    }),

    create_handoff_rule: tool({
      description: 'Create a new handoff rule. When a lead message matches any keyword, admins are alerted.',
      inputSchema: z.object({
        description: z.string().min(1).max(255).describe('Human-readable description of when this rule fires'),
        trigger_keywords: z.array(z.string().min(1)).min(1).describe('Keywords that trigger this rule')
      }),
      execute: async ({ description, trigger_keywords }) => {
        const rule = await createHandoffRule({ agency_id: ctx.config.agency_id, description, trigger_keywords });
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, id: rule.id, description: rule.description, active: rule.active };
      }
    }),

    toggle_handoff_rule: tool({
      description: 'Activate or deactivate a handoff rule by ID.',
      inputSchema: z.object({
        rule_id: z.string(),
        active: z.boolean()
      }),
      execute: async ({ rule_id, active }) => {
        const rule = await toggleHandoffRule(rule_id, active);
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, id: rule.id, description: rule.description, active: rule.active };
      }
    }),

    delete_handoff_rule: tool({
      description: 'Permanently delete a handoff rule.',
      inputSchema: z.object({ rule_id: z.string() }),
      execute: async ({ rule_id }) => {
        await deleteHandoffRule(rule_id);
        broadcastAgencyDataChanged(ctx.config.agency_id);
        return { ok: true, deleted: rule_id };
      }
    })
  };
}
