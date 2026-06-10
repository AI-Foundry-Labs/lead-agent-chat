import { z } from 'zod';
import type { Criterion } from '@/lib/db/schema';

export type { Criterion };

export type Channel = 'web' | 'email' | 'telegram';
export type Language = 'fr' | 'en';
export type LeadStatus =
  | 'active'
  | 'qualified'
  | 'booked'
  | 'handoff'
  | 'abandoned';
export type PotentialStatus = 'hot' | 'warm' | 'cold';
export type ConversationType =
  | 'lead'
  | 'steward'
  | 'main_assistant';
export type ConversationMode = 'agent' | 'manual';
export type MessageRole = 'user' | 'assistant' | 'admin' | 'tool' | 'system';
export type ViewingStatus = 'proposed' | 'booked' | 'cancelled';

export interface Conversation {
  id: string;
  type: ConversationType;
  lead_id: string | null;
  admin_id: string | null;
  listing_id: string | null;
  primary_channel: Channel;
  mode: ConversationMode;
  thread_summary: string | null;
  summarized_turn_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_calls: unknown | null;
  tool_results: unknown | null;
  is_draft: boolean;
  timestamp: Date;
}

export interface Lead {
  id: string;
  channel: Channel;
  email: string | null;
  name: string | null;
  listing_id: string | null;
  language: Language;
  status: LeadStatus;
  qual_values: Record<string, string>;
  potential_status: PotentialStatus | null;
  score_reason: string | null;
  long_term_memory: string | null;
  telegram_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ViewingSlot {
  id: string;
  conversation_id: string;
  lead_id: string | null;
  listing_id: string;
  contact_email: string | null;
  proposed_slots: string[];
  confirmed_slot: Date | null;
  status: ViewingStatus;
  calendar_event_id: string | null;
  summary: string | null;
  created_at: Date;
}

export interface AgencyConfig {
  id: string;
  name: string;
  tone: string;
  qualification_criteria: Criterion[];
  calendar_id: string;
}

export interface HandoffRule {
  id: string;
  description: string;
  trigger_keywords: string[];
  active: boolean;
  created_at: Date;
}

export interface Listing {
  id: string;
  title: string;
  title_en: string;
  address: string;
  price: number;
  surface_m2: number;
  rooms: number;
  floor: string;
  floor_en: string;
  description: string;
  description_en: string;
  key_features: string[];
  key_features_en: string[];
  image_url: string | null;
  agent_name: string;
  agent_email: string;
  agent_calendar_id: string;
}

// ─── Zod schemas (reused by tool inputs + API validation) ──────────────────

export const criterionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'key must be lowercase letters, digits, underscores'),
  label: z.string().min(1).max(120),
  hint: z.string().max(240).optional()
});

export const listingSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'id must be lowercase letters, digits, and dashes'),
  title: z.string().min(1).max(255),
  title_en: z.string().min(1).max(255),
  address: z.string().min(1).max(500),
  price: z.number().int().nonnegative(),
  surface_m2: z.number().int().positive(),
  rooms: z.number().int().positive(),
  floor: z.string().min(1).max(255),
  floor_en: z.string().min(1).max(255),
  description: z.string().min(1),
  description_en: z.string().min(1),
  key_features: z.array(z.string().min(1)),
  key_features_en: z.array(z.string().min(1)),
  image_url: z
    .union([
      z.string().url().max(1000),
      z.string().regex(/^\/uploads\/listings\/[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp)$/)
    ])
    .nullable()
    .optional(),
  agent_name: z.string().min(1).max(255),
  agent_email: z.string().email().max(255),
  agent_calendar_id: z.string().min(1).max(255)
});

export const listingUpdateSchema = listingSchema.partial().omit({ id: true });
