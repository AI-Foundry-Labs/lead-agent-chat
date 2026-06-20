import { and, eq, desc } from 'drizzle-orm';
import { db, message_templates } from './client';

export type MessageTemplate = typeof message_templates.$inferSelect;

/** List all templates for an agency (newest first). */
export async function listMessageTemplates(
  agencyId: string
): Promise<MessageTemplate[]> {
  return db
    .select()
    .from(message_templates)
    .where(eq(message_templates.agency_id, agencyId))
    .orderBy(desc(message_templates.updated_at));
}

/** Get a single template, scoped to its agency (null if missing/foreign). */
export async function getMessageTemplate(
  agencyId: string,
  id: string
): Promise<MessageTemplate | null> {
  const rows = await db
    .select()
    .from(message_templates)
    .where(and(eq(message_templates.id, id), eq(message_templates.agency_id, agencyId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createMessageTemplate(input: {
  agency_id: string;
  title: string;
  body: string;
}): Promise<MessageTemplate> {
  const [r] = await db.insert(message_templates).values(input).returning();
  return r;
}

/** Update title/body; agency-scoped. Returns null if not found for this agency. */
export async function updateMessageTemplate(
  agencyId: string,
  id: string,
  patch: { title?: string; body?: string }
): Promise<MessageTemplate | null> {
  const [r] = await db
    .update(message_templates)
    .set({ ...patch, updated_at: new Date() })
    .where(and(eq(message_templates.id, id), eq(message_templates.agency_id, agencyId)))
    .returning();
  return r ?? null;
}

/** Delete a template; agency-scoped. Returns true if a row was removed. */
export async function deleteMessageTemplate(
  agencyId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .delete(message_templates)
    .where(and(eq(message_templates.id, id), eq(message_templates.agency_id, agencyId)))
    .returning({ id: message_templates.id });
  return rows.length > 0;
}
