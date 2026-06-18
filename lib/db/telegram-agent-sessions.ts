import { eq } from 'drizzle-orm';
import { db, telegram_agent_sessions } from './client';

export type AgentSession =
  | { agent_kind: 'main'; lead_id: null }
  | { agent_kind: 'operator'; lead_id: string };

export type ActiveActor =
  | { type: 'main_assistant' }
  | { type: 'operator'; leadId: string };

/** Pure: map a stored session row to the actor runAgentTurn expects. */
export function resolveActiveActor(session: AgentSession | null): ActiveActor | null {
  if (!session) return null;
  if (session.agent_kind === 'operator' && session.lead_id) {
    return { type: 'operator', leadId: session.lead_id };
  }
  return { type: 'main_assistant' };
}

export async function getAgentSession(agencyId: string): Promise<AgentSession | null> {
  const [row] = await db
    .select()
    .from(telegram_agent_sessions)
    .where(eq(telegram_agent_sessions.agency_id, agencyId))
    .limit(1);
  if (!row) return null;
  return row.agent_kind === 'operator' && row.lead_id
    ? { agent_kind: 'operator', lead_id: row.lead_id }
    : { agent_kind: 'main', lead_id: null };
}

export async function setAgentSession(agencyId: string, session: AgentSession): Promise<void> {
  await db
    .insert(telegram_agent_sessions)
    .values({
      agency_id: agencyId,
      agent_kind: session.agent_kind,
      lead_id: session.lead_id,
      updated_at: new Date()
    })
    .onConflictDoUpdate({
      target: telegram_agent_sessions.agency_id,
      set: { agent_kind: session.agent_kind, lead_id: session.lead_id, updated_at: new Date() }
    });
}
