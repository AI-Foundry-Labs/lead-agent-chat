import { eq } from 'drizzle-orm';
import { db, admins } from './client';

export type Admin = typeof admins.$inferSelect;

/** Returns all admin accounts belonging to the given agency. */
export async function listAdminsByAgency(agencyId: string): Promise<Admin[]> {
  return db.select().from(admins).where(eq(admins.agency_id, agencyId));
}
