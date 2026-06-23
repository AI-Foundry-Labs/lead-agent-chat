/**
 * Pure title-builder functions for Telegram topic display names.
 * No DB, no Telegram API calls — pure string logic.
 *
 * Moved here from lead-topics.ts (now deleted) so unit tests and
 * any future callers can import from a stable, dependency-free module.
 */
import type { PotentialStatus } from '@/lib/types';

// ─── Status emoji map ─────────────────────────────────────────────────────────
// Moved from sync-lead-topic-titles.ts (now deleted) — tests + lead-status-marker
// imported it from there; they now import from here.

export const STATUS_EMOJI: Record<PotentialStatus, string> = {
  hot: '🔥',
  warm: '🟡',
  cold: '❄️'
};

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
