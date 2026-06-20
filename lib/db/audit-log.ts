import { and, eq, desc } from 'drizzle-orm';
import { db, audit_log } from './client';

export type AuditEntry = typeof audit_log.$inferSelect;

/** List audit entries for one lead (agency-scoped, newest first). */
export async function listAuditByLead(
  agencyId: string,
  leadId: string,
  limit = 50
): Promise<AuditEntry[]> {
  return db
    .select()
    .from(audit_log)
    .where(and(eq(audit_log.agency_id, agencyId), eq(audit_log.target_lead_id, leadId)))
    .orderBy(desc(audit_log.timestamp))
    .limit(limit);
}
