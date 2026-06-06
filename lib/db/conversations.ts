import { and, desc, eq } from 'drizzle-orm';
import { db, conversations } from './client';
import type {
  Channel,
  Conversation,
  ConversationMode,
  ConversationType
} from '@/lib/types';

function rowToConversation(r: typeof conversations.$inferSelect): Conversation {
  return {
    id: r.id,
    type: r.type as ConversationType,
    lead_id: r.lead_id,
    admin_id: r.admin_id,
    listing_id: r.listing_id,
    primary_channel: r.primary_channel as Channel,
    mode: r.mode as ConversationMode,
    created_at: r.created_at,
    updated_at: r.updated_at
  };
}

export async function createConversation(input: {
  type: ConversationType;
  lead_id?: string | null;
  admin_id?: string | null;
  listing_id?: string | null;
  primary_channel?: Channel;
}): Promise<Conversation> {
  const [r] = await db
    .insert(conversations)
    .values({
      type: input.type,
      lead_id: input.lead_id ?? null,
      admin_id: input.admin_id ?? null,
      listing_id: input.listing_id ?? null,
      primary_channel: input.primary_channel ?? 'web'
    })
    .returning();
  return rowToConversation(r);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function getAdminAssistantConversation(
  adminId: string
): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.type, 'admin_assistant'),
        eq(conversations.admin_id, adminId)
      )
    )
    .orderBy(desc(conversations.updated_at))
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function getConversationByLeadId(
  leadId: string
): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.type, 'lead'), eq(conversations.lead_id, leadId))
    )
    .orderBy(desc(conversations.updated_at))
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function getOrCreateAdminAssistant(
  adminId: string
): Promise<Conversation> {
  return (
    (await getAdminAssistantConversation(adminId)) ??
    (await createConversation({
      type: 'admin_assistant',
      admin_id: adminId,
      primary_channel: 'web'
    }))
  );
}

export async function updateConversation(
  id: string,
  patch: Partial<{
    lead_id: string | null;
    listing_id: string | null;
    primary_channel: Channel;
    mode: ConversationMode;
  }>
): Promise<Conversation> {
  const [r] = await db
    .update(conversations)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return rowToConversation(r);
}

export async function touchConversation(id: string): Promise<void> {
  await db
    .update(conversations)
    .set({ updated_at: new Date() })
    .where(eq(conversations.id, id));
}
