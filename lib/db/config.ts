import { eq } from 'drizzle-orm';
import { db, agency_config } from './client';
import type { AgencyConfig, Criterion } from '@/lib/types';

function rowToConfig(r: typeof agency_config.$inferSelect): AgencyConfig {
  return {
    id: r.id,
    name: r.name,
    tone: r.tone,
    qualification_criteria: r.qualification_criteria,
    calendar_id: r.calendar_id
  };
}

export async function getAgencyConfig(): Promise<AgencyConfig | null> {
  const rows = await db.select().from(agency_config).limit(1);
  return rows[0] ? rowToConfig(rows[0]) : null;
}

export async function upsertAgencyConfig(
  input: Omit<AgencyConfig, 'id'> & { id?: string }
): Promise<AgencyConfig> {
  const existing = await getAgencyConfig();
  const values = {
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
  criteria: Criterion[]
): Promise<AgencyConfig> {
  const existing = await getAgencyConfig();
  if (!existing) throw new Error('Agency config not initialized — run db:seed');
  const [r] = await db
    .update(agency_config)
    .set({ qualification_criteria: criteria })
    .where(eq(agency_config.id, existing.id))
    .returning();
  return rowToConfig(r);
}
