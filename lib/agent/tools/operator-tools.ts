/**
 * Unified operator tools. Replaces the former lead-operator + anonymous-operator split.
 *
 * One operator agent operates in two scopes via scopedLeadId:
 *   - lead mode  (scopedLeadId set):  one identified/known lead + its threads
 *   - pool mode  (scopedLeadId null): the anonymous / unidentified visitor pool
 *
 * Thread tools adapt to scope; lead-management tools default to the scoped lead
 * (or accept an explicit lead_id for pool-mode triage).
 */
import { buildOperatorThreadTools } from './operator-thread-tools';
import { buildOperatorLeadActions } from './operator-lead-actions';
import type { AgentContext } from './context';

export function buildOperatorTools(ctx: AgentContext, scopedLeadId: string | null) {
  return {
    ...buildOperatorThreadTools(ctx, scopedLeadId),
    ...buildOperatorLeadActions(ctx, scopedLeadId)
  };
}
