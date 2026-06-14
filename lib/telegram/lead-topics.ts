/**
 * getOrCreateLeadTopics — lazily provision two forum topics per lead.
 *
 * Topic 1: 💬 {leadName} — {listingTitle}   (mirrors lead↔agent conversation)
 * Topic 2: 🤖 {leadName} — Assistant        (per-lead copilot / operator thread)
 *
 * Idempotent: re-uses existing mapping row if present. Concurrent calls are
 * safe via the unique (group_chat_id, lead_id) DB constraint + ON CONFLICT DO NOTHING.
 *
 * Returns null (does NOT throw) when:
 * - Agency has no linked Telegram group.
 * - telegram_topics_enabled is false on the agency.
 * - Any Telegram API call fails (topics already created → orphan risk noted below).
 *
 * KNOWN RISK (red-team M3): Telegram supergroup max-topics ceiling is unverified.
 * At small agency scale (<100 active leads) this is acceptable for v1.
 *
 * ORPHAN RISK: if topics are created in Telegram but the DB insert is interrupted,
 * the orphan topics remain. Reconciliation by name lookup is deferred (YAGNI for v1).
 */

import { getAgencyById } from '@/lib/db/agencies';
import { getListing } from '@/lib/db/listings';
import { getLeadById } from '@/lib/db/leads';
import {
  getLeadTopicsByLead,
  insertLeadTopics,
  closeLeadTopics as dbCloseLeadTopics
} from '@/lib/db/lead-telegram-topics';
import type { LeadTelegramTopics } from '@/lib/db/lead-telegram-topics';
import { getConversationByLeadId, getOrCreateLeadOperator } from '@/lib/db/conversations';
import { createForumTopic } from '@/lib/telegram';

// ─── Title builders ───────────────────────────────────────────────────────────

/**
 * Display name for a lead — falls back to email local-part, then a sequence-numbered
 * "Visiteur #N" for anonymous visitors, then plain "Visiteur".
 * Keep short for topic title readability.
 */
export function buildLeadDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
  anonSeq?: number | null
): string {
  if (name && name.trim()) return name.trim();
  if (email && email.includes('@')) return email.split('@')[0];
  if (anonSeq != null) return `Visiteur #${anonSeq}`;
  return 'Visiteur';
}

/**
 * Title for the 💬 Conversation topic.
 * e.g. "💬 Marie D. — Marais 2BR"
 */
export function buildConversationTopicTitle(
  leadDisplayName: string,
  listingTitle: string | null | undefined
): string {
  const listing = listingTitle?.trim() || '';
  return listing
    ? `💬 ${leadDisplayName} — ${listing}`
    : `💬 ${leadDisplayName}`;
}

/**
 * Title for the 🤖 Assistant topic.
 * e.g. "🤖 Marie D. — Assistant"
 */
export function buildAssistantTopicTitle(leadDisplayName: string): string {
  return `🤖 ${leadDisplayName} — Assistant`;
}

// ─── Main orchestration ───────────────────────────────────────────────────────

/**
 * Ensure two forum topics exist for the given lead in the agency's group.
 * Returns the persisted mapping, or null when topics are not applicable.
 */
export async function getOrCreateLeadTopics(
  agencyId: string,
  leadId: string
): Promise<LeadTelegramTopics | null> {
  // 1. Verify agency has a linked forum group with topics enabled.
  const agency = await getAgencyById(agencyId);
  if (!agency?.telegram_group_chat_id || !agency.telegram_topics_enabled) {
    return null;
  }
  const groupChatId = agency.telegram_group_chat_id;

  // 2. Return early if mapping already exists (idempotent fast-path).
  const existing = await getLeadTopicsByLead(agencyId, leadId);
  if (existing) return existing;

  // 3. Load lead + listing for title building.
  const lead = await getLeadById(leadId);
  if (!lead) {
    console.warn('[lead-topics] getOrCreateLeadTopics: lead not found', leadId);
    return null;
  }

  const listing = lead.listing_id ? await getListing(lead.listing_id) : null;
  const displayName = buildLeadDisplayName(lead.name, lead.email, lead.anon_seq);
  const convTitle = buildConversationTopicTitle(displayName, listing?.title);
  const asstTitle = buildAssistantTopicTitle(displayName);

  // 4. Create both Telegram forum topics.
  const conversationTopicId = await createForumTopic(groupChatId, convTitle);
  if (conversationTopicId === null) {
    console.error('[lead-topics] createForumTopic (conversation) failed for lead', leadId);
    return null;
  }

  const assistantTopicId = await createForumTopic(groupChatId, asstTitle);
  if (assistantTopicId === null) {
    // NOTE: conversationTopicId was already created — orphan topic in Telegram.
    // Reconciliation deferred (YAGNI v1). Log clearly so it can be found.
    console.error(
      '[lead-topics] createForumTopic (assistant) failed for lead',
      leadId,
      '— conversation topic orphaned:',
      conversationTopicId
    );
    return null;
  }

  // 5. Resolve conversation ids for the mapping row.
  //    Lead conversation: the existing 'lead' type thread for this lead (any channel).
  //    Operator conversation: the admin-facing 'operator' scoped to this lead.
  const leadConv = await getConversationByLeadId(leadId);
  const operatorConv = await getOrCreateLeadOperator(leadId, agencyId);

  // 6. Persist the mapping (idempotent: ON CONFLICT DO NOTHING → re-select).
  return insertLeadTopics({
    agency_id: agencyId,
    lead_id: leadId,
    group_chat_id: groupChatId,
    conversation_topic_id: conversationTopicId,
    assistant_topic_id: assistantTopicId,
    lead_conversation_id: leadConv?.id ?? null,
    operator_conversation_id: operatorConv.id
  });
}

/**
 * Mark a lead's forum topics as closed in the DB.
 * Actual Telegram topic closure (closeForumTopic API call) is left to Phase 05
 * (handoff completion) where the caller controls when to surface the UI event.
 */
export async function closeLeadTopics(leadId: string): Promise<void> {
  await dbCloseLeadTopics(leadId);
}
