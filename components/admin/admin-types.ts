import type { Listing, Criterion, HandoffRule } from '@/lib/types';

export type AdminLead = {
  id: string;
  name: string | null;
  email: string | null;
  listing_id: string | null;
  listing_title: string | null;
  status: string;
  potential: string | null;
  reason: string | null;
  qual_values: Record<string, string>;
  booked_slot: string | null;
  thread_count: number;
  updated_at: string;
};

export type AdminThread = {
  id: string;
  lead_id?: string | null;
  channel: string;
  listing_id: string | null;
  listing_title: string | null;
  mode: string;
  thread_summary: string | null;
  updated_at: string;
};

export type AdminData = {
  leads: AdminLead[];
  anonymous: { thread_count: number; handoff_count: number };
  listings: Listing[];
  criteria: Criterion[];
  config: { name: string; tone: string } | null;
  rules: HandoffRule[];
  adminPersona: string | null;
};

export const POTENTIAL_COLOR: Record<string, string> = {
  hot: 'bg-red-100 text-red-700',
  warm: 'bg-amber-100 text-amber-700',
  cold: 'bg-sky-100 text-sky-700'
};

export async function adminAction(payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch('/api/admin/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.ok;
}
