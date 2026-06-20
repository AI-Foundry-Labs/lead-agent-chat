import { eq } from 'drizzle-orm';
import { db, admins } from './client';

export type Admin = typeof admins.$inferSelect;

/** Returns all admin accounts belonging to the given agency. */
export async function listAdminsByAgency(agencyId: string): Promise<Admin[]> {
  return db.select().from(admins).where(eq(admins.agency_id, agencyId));
}

export async function getAdminById(adminId: string): Promise<Admin | null> {
  const rows = await db.select().from(admins).where(eq(admins.id, adminId)).limit(1);
  return rows[0] ?? null;
}

export async function updateAdminPersona(adminId: string, persona: string | null): Promise<void> {
  await db.update(admins).set({ persona }).where(eq(admins.id, adminId));
}
