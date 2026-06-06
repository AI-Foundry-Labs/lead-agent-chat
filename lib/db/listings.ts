import { desc, eq } from 'drizzle-orm';
import { db, listings } from './client';
import type { Listing } from '@/lib/types';

function rowToListing(r: typeof listings.$inferSelect): Listing {
  return {
    id: r.id,
    title: r.title,
    title_en: r.title_en,
    address: r.address,
    price: r.price,
    surface_m2: r.surface_m2,
    rooms: r.rooms,
    floor: r.floor,
    floor_en: r.floor_en,
    description: r.description,
    description_en: r.description_en,
    key_features: r.key_features,
    key_features_en: r.key_features_en,
    image_url: r.image_url,
    agent_name: r.agent_name,
    agent_email: r.agent_email,
    agent_calendar_id: r.agent_calendar_id
  };
}

export async function listListings(): Promise<Listing[]> {
  const rows = await db
    .select()
    .from(listings)
    .orderBy(desc(listings.created_at));
  return rows.map(rowToListing);
}

export async function getListingById(id: string): Promise<Listing | null> {
  const rows = await db
    .select()
    .from(listings)
    .where(eq(listings.id, id))
    .limit(1);
  return rows[0] ? rowToListing(rows[0]) : null;
}

export async function getListing(
  id: string | null | undefined
): Promise<Listing | null> {
  if (!id) return null;
  return getListingById(id);
}

export async function createListing(input: Listing): Promise<Listing> {
  const [r] = await db.insert(listings).values(input).returning();
  return rowToListing(r);
}

export async function updateListing(
  id: string,
  patch: Partial<Omit<Listing, 'id'>>
): Promise<Listing> {
  const [r] = await db
    .update(listings)
    .set(patch)
    .where(eq(listings.id, id))
    .returning();
  return rowToListing(r);
}

export async function deleteListing(id: string): Promise<void> {
  await db.delete(listings).where(eq(listings.id, id));
}
