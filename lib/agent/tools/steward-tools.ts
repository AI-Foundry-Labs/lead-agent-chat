/**
 * Unified steward tools. Replaces the former lead-steward + anonymous-steward split.
 *
 * One steward agent operates in two scopes via scopedLeadId:
 *   - lead mode  (scopedLeadId set):  one identified/known lead + its threads
 *   - pool mode  (scopedLeadId null): the anonymous / unidentified visitor pool
 *
 * Thread tools adapt to scope; lead-management tools default to the scoped lead
 * (or accept an explicit lead_id for pool-mode triage).
 */
import { buildStewardThreadTools } from './steward-thread-tools';
import { buildStewardLeadActions } from './steward-lead-actions';
import type { AgentContext } from './context';

export function buildStewardTools(ctx: AgentContext, scopedLeadId: string | null) {
  return {
    ...buildStewardThreadTools(ctx, scopedLeadId),
    ...buildStewardLeadActions(ctx, scopedLeadId)
  };
}
