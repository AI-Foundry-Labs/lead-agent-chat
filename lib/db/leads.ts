import { desc, eq } from 'drizzle-orm';
import { db, leads } from './client';
import type {
  Channel,
  Language,
  Lead,
  LeadStatus,
  PotentialStatus
} from '@/lib/types';
import { isIdentifiedLead } from '@/lib/leads/is-identified-lead';

function rowToLead(r: typeof leads.$inferSelect): Lead {
  return {
    id: r.id,
    agency_id: r.agency_id,
    channel: r.channel as Channel,
    email: r.email,
    name: r.name,
    listing_id: r.listing_id,
    language: r.language as Language,
    status: r.status as LeadStatus,
    qual_values: r.qual_values ?? {},
    potential_status: (r.potential_status as PotentialStatus | null) ?? null,
    score_reason: r.score_reason,
    long_term_memory: r.long_term_memory,
    telegram_user_id: r.telegram_user_id,
    created_at: r.created_at,
    updated_at: r.updated_at
  };
}

export async function getLeadById(id: string): Promise<Lead | null> {
  const rows = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return rows[0] ? rowToLead(rows[0]) : null;
}

export async function getLeadByEmail(email: string): Promise<Lead | null> {
  const rows = await db
    .select()
    .from(leads)
    .where(eq(leads.email, email))
    .limit(1);
  return rows[0] ? rowToLead(rows[0]) : null;
}

export async function listLeads(agencyId: string): Promise<Lead[]> {
  const rows = await db
    .select()
    .from(leads)
    .where(eq(leads.agency_id, agencyId))
    .orderBy(desc(leads.updated_at));
  return rows.map(rowToLead);
}

export async function listLeadsByStatus(
  agencyId: string,
  status: LeadStatus
): Promise<Lead[]> {
  const rows = await db
    .select()
    .from(leads)
    .where(eq(leads.agency_id, agencyId))
    .orderBy(desc(leads.updated_at));
  return rows.map(rowToLead).filter((l) => l.status === status);
}

export async function listIdentifiedLeads(agencyId: string): Promise<Lead[]> {
  const rows = await db
    .select()
    .from(leads)
    .where(eq(leads.agency_id, agencyId))
    .orderBy(desc(leads.updated_at));
  return rows.map(rowToLead).filter(isIdentifiedLead);
}

export async function createLead(input: {
  agency_id: string;
  channel?: Channel;
  email?: string | null;
  name?: string | null;
  listing_id?: string | null;
  language?: Language;
  qual_values?: Record<string, string>;
}): Promise<Lead> {
  const [r] = await db
    .insert(leads)
    .values({
      agency_id: input.agency_id,
      channel: input.channel ?? 'web',
      email: input.email ?? null,
      name: input.name ?? null,
      listing_id: input.listing_id ?? null,
      language: input.language ?? 'fr',
      qual_values: input.qual_values ?? {}
    })
    .returning();
  return rowToLead(r);
}

export async function updateLead(
  id: string,
  patch: Partial<{
    name: string | null;
    email: string | null;
    listing_id: string | null;
    language: Language;
    status: LeadStatus;
    qual_values: Record<string, string>;
    potential_status: PotentialStatus | null;
    score_reason: string | null;
    long_term_memory: string | null;
    telegram_user_id: string | null;
  }>
): Promise<Lead> {
  const [r] = await db
    .update(leads)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(leads.id, id))
    .returning();
  return rowToLead(r);
}
