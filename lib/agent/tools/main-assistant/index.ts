// Barrel: merges all per-domain tool builders into the single object expected by run.ts.
// Signature of buildMainAssistantTools is unchanged — callers need no update.
import type { AgentContext } from '@/lib/agent/tools/context';
import { buildLeadsTools } from './leads';
import { buildMessagingTools } from './messaging';
import { buildListingsTools } from './listings';
import { buildViewingsTools } from './viewings';
import { buildConfigTools } from './config';
import { buildTelegramTools } from './telegram';
import { buildAnalyticsTools } from './analytics';
import { buildSubagentsTools } from './subagents';
export type { RunAgentTurn } from './types';

export function buildMainAssistantTools(
  ctx: AgentContext,
  adminId: string,
  adminName: string | null,
  runAgentTurn: Parameters<typeof buildMessagingTools>[3]
) {
  return {
    ...buildLeadsTools(ctx),
    ...buildMessagingTools(ctx, adminId, adminName, runAgentTurn),
    ...buildListingsTools(ctx),
    ...buildViewingsTools(ctx),
    ...buildConfigTools(ctx),
    ...buildTelegramTools(ctx),
    ...buildAnalyticsTools(ctx),
    ...buildSubagentsTools(ctx, adminId, adminName, runAgentTurn)
  };
}
