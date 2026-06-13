import { eq } from 'drizzle-orm';
import { db, agency_config } from './client';
import type { AgencyConfig, Criterion } from '@/lib/types';

function rowToConfig(r: typeof agency_config.$inferSelect): AgencyConfig {
  return {
    id: r.id,
    agency_id: r.agency_id,
    name: r.name,
    tone: r.tone,
    qualification_criteria: r.qualification_criteria,
    calendar_id: r.calendar_id
  };
}

/** Get config for a specific agency. Returns null if not initialized. */
export async function getAgencyConfig(agencyId: string): Promise<AgencyConfig | null> {
  const rows = await db
    .select()
    .from(agency_config)
    .where(eq(agency_config.agency_id, agencyId))
    .limit(1);
  return rows[0] ? rowToConfig(rows[0]) : null;
}

export async function upsertAgencyConfig(
  input: Omit<AgencyConfig, 'id'> & { id?: string }
): Promise<AgencyConfig> {
  const existing = await getAgencyConfig(input.agency_id);
  const values = {
    agency_id: input.agency_id,
    name: input.name,
    tone: input.tone,
    qualification_criteria: input.qualification_criteria,
    calendar_id: input.calendar_id
  };
  if (existing) {
    const [r] = await db
      .update(agency_config)
      .set(values)
      .where(eq(agency_config.id, existing.id))
      .returning();
    return rowToConfig(r);
  }
  const [r] = await db.insert(agency_config).values(values).returning();
  return rowToConfig(r);
}

export async function updateCriteria(
  agencyId: string,
  criteria: Criterion[]
): Promise<AgencyConfig> {
  const existing = await getAgencyConfig(agencyId);
  if (!existing) throw new Error('Agency config not initialized — run db:seed');
  const [r] = await db
    .update(agency_config)
    .set({ qualification_criteria: criteria })
    .where(eq(agency_config.id, existing.id))
    .returning();
  return rowToConfig(r);
}
