// Barrel for the data layer. Domain helpers live in sibling modules; tables and
// the drizzle client come from ./client. Import from '@/lib/db' everywhere.
export {
  db,
  agencies,
  conversations,
  messages,
  leads,
  viewing_slots,
  agency_config,
  listings,
  handoff_rules,
  admins,
  admin_sessions,
  lead_sessions,
  lead_magic_links,
  telegram_link_tokens,
  lead_telegram_link_tokens,
  agency_telegram_link_tokens,
  lead_telegram_topics,
  telegram_agent_sessions
} from './client';

export * from './conversations';
export * from './messages';
export * from './leads';
export { isIdentifiedLead } from '../leads/is-identified-lead';
export * from './listings';
export * from './config';
export * from './viewings';
export * from './handoff';
export * from './telegram-links';
export * from './lead-telegram-links';
export type { LeadTelegramLinkPayload } from './lead-telegram-links';
export * from './agencies';
export * from './agency-telegram-links';
export * from './lead-telegram-topics';
export type { LeadTelegramTopics } from './lead-telegram-topics';
export * from './telegram-agent-sessions';
export * from './admins';
