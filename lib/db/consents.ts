import { and, eq, desc } from 'drizzle-orm';
import { db, lead_consents } from './client';

export type ConsentType = 'data_processing' | 'marketing' | 'phone_contact';

export interface ConsentState {
  consent_type: string;
  granted: boolean;
  source: string | null;
  recorded_at: Date;
}

/** Append a consent grant/withdrawal row (history is immutable). */
export async function setConsent(input: {
  agency_id: string;
  lead_id: string;
  consent_type: ConsentType;
  granted: boolean;
  source?: string | null;
  recorded_by?: string | null;
  notes?: string | null;
}): Promise<void> {
  await db.insert(lead_consents).values({
    agency_id: input.agency_id,
    lead_id: input.lead_id,
    consent_type: input.consent_type,
    granted: input.granted,
    source: input.source ?? null,
    recorded_by: input.recorded_by ?? null,
    notes: input.notes ?? null
  });
}

/** Current consent state = latest row per consent_type for the lead. */
export async function getLatestConsents(
  agencyId: string,
  leadId: string
): Promise<ConsentState[]> {
  const rows = await db
    .select()
    .from(lead_consents)
    .where(and(eq(lead_consents.agency_id, agencyId), eq(lead_consents.lead_id, leadId)))
    .orderBy(desc(lead_consents.recorded_at));
  const seen = new Set<string>();
  const latest: ConsentState[] = [];
  for (const r of rows) {
    if (seen.has(r.consent_type)) continue;
    seen.add(r.consent_type);
    latest.push({
      consent_type: r.consent_type,
      granted: r.granted,
      source: r.source,
      recorded_at: r.recorded_at
    });
  }
  return latest;
}
