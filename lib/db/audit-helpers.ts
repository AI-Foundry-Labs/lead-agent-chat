import { db, audit_log } from './client';

export type AuditActorType = 'admin' | 'agent' | 'system';

/**
 * Best-effort audit write (F4d). NEVER throws into the caller — a failed audit
 * insert must not break the agent turn (same posture as long-term-memory writes).
 */
export async function recordAudit(input: {
  agency_id: string;
  action: string;
  target_lead_id?: string | null;
  admin_id?: string | null;
  actor_type?: AuditActorType;
  details?: unknown;
}): Promise<void> {
  try {
    await db.insert(audit_log).values({
      agency_id: input.agency_id,
      admin_id: input.admin_id ?? null,
      actor_type: input.actor_type ?? 'admin',
      action: input.action,
      target_lead_id: input.target_lead_id ?? null,
      details: (input.details ?? null) as never
    });
  } catch (e) {
    console.error('[audit] recordAudit failed (non-fatal):', input.action, e);
  }
}
