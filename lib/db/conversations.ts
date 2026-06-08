import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db, conversations, leads } from './client';
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
    thread_summary: r.thread_summary,
    summarized_turn_count: r.summarized_turn_count,
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

/** All lead threads owned by this visitor (inbox / threads page). */
export async function listConversationsByLeadId(
  leadId: string
): Promise<Conversation[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.type, 'lead'), eq(conversations.lead_id, leadId))
    )
    .orderBy(desc(conversations.updated_at));
  return rows.map(rowToConversation);
}

/** Attach anonymous listing chats to a logged-in lead after sign-in. */
export async function claimConversationsForLead(
  leadId: string,
  conversationIds: string[]
): Promise<string[]> {
  const claimed: string[] = [];
  for (const id of conversationIds) {
    const conv = await getConversation(id);
    if (!conv || conv.type !== 'lead' || conv.lead_id) continue;
    await updateConversation(id, { lead_id: leadId });
    claimed.push(id);
  }
  return claimed;
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

export async function getMainAssistantConversation(
  adminId: string
): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.type, 'main_assistant'),
        eq(conversations.admin_id, adminId)
      )
    )
    .orderBy(desc(conversations.updated_at))
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function getOrCreateMainAssistant(
  adminId: string
): Promise<Conversation> {
  return (
    (await getMainAssistantConversation(adminId)) ??
    (await createConversation({
      type: 'main_assistant',
      admin_id: adminId,
      primary_channel: 'web'
    }))
  );
}

/** Lead thread on a specific channel + listing (web and telegram are separate sessions). */
export async function getLeadConversationByChannel(
  leadId: string,
  listingId: string | null,
  channel: Channel
): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.type, 'lead'),
        eq(conversations.lead_id, leadId),
        eq(conversations.primary_channel, channel),
        listingId
          ? eq(conversations.listing_id, listingId)
          : isNull(conversations.listing_id)
      )
    )
    .orderBy(desc(conversations.updated_at))
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function getOrCreateLeadTelegramConversation(input: {
  leadId: string;
  listingId: string | null;
}): Promise<Conversation> {
  return (
    (await getLeadConversationByChannel(
      input.leadId,
      input.listingId,
      'telegram'
    )) ??
    (await createConversation({
      type: 'lead',
      lead_id: input.leadId,
      listing_id: input.listingId,
      primary_channel: 'telegram'
    }))
  );
}

/** Latest telegram lead thread for routing inbound Telegram messages. */
export async function getMostRecentLeadTelegramConversation(
  leadId: string
): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.type, 'lead'),
        eq(conversations.lead_id, leadId),
        eq(conversations.primary_channel, 'telegram')
      )
    )
    .orderBy(desc(conversations.updated_at))
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

/** Admin-facing agent scoped to one identified lead (1:1). */
export async function getLeadStewardConversation(
  leadId: string
): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.type, 'lead_steward'), eq(conversations.lead_id, leadId))
    )
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function getOrCreateLeadSteward(leadId: string): Promise<Conversation> {
  return (
    (await getLeadStewardConversation(leadId)) ??
    (await createConversation({
      type: 'lead_steward',
      lead_id: leadId,
      primary_channel: 'web'
    }))
  );
}

/** Singleton admin agent for all anonymous / unidentified visitors. */
export async function getAnonymousStewardConversation(): Promise<Conversation | null> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.type, 'anonymous_steward'))
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function getOrCreateAnonymousSteward(): Promise<Conversation> {
  return (
    (await getAnonymousStewardConversation()) ??
    (await createConversation({
      type: 'anonymous_steward',
      primary_channel: 'web'
    }))
  );
}

/** Visitor-facing threads for anonymous pool (no email/name on lead, or no lead yet). */
export async function listAnonymousVisitorThreads(): Promise<Conversation[]> {
  const rows = await db
    .select({ conv: conversations })
    .from(conversations)
    .leftJoin(leads, eq(conversations.lead_id, leads.id))
    .where(
      and(
        eq(conversations.type, 'lead'),
        or(
          isNull(conversations.lead_id),
          and(isNull(leads.email), isNull(leads.name))
        )
      )
    )
    .orderBy(desc(conversations.updated_at));
  return rows.map((r) => rowToConversation(r.conv));
}

export async function getConversationByIdForLead(
  conversationId: string,
  leadId: string
): Promise<Conversation | null> {
  const conv = await getConversation(conversationId);
  if (!conv || conv.type !== 'lead' || conv.lead_id !== leadId) return null;
  return conv;
}

export async function updateConversation(
  id: string,
  patch: Partial<{
    lead_id: string | null;
    listing_id: string | null;
    primary_channel: Channel;
    mode: ConversationMode;
    thread_summary: string | null;
    summarized_turn_count: number;
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
