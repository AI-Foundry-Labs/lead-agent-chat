import { google } from 'googleapis';
import type { Listing } from '@/lib/types';

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) return null;
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
}

const TZ = 'Europe/Paris';

function isWeekday(d: Date) {
  const w = d.getUTCDay();
  return w !== 0 && w !== 6;
}

// Return the UTC offset (in hours) for Europe/Paris at the given date.
// CEST (summer) = UTC+2; CET (winter) = UTC+1.
function parisUtcOffset(d: Date): number {
  // Use Intl to determine the actual Paris offset for this date.
  const parisFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    hour12: false
  });
  const utcFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: 'numeric',
    hour12: false
  });
  const parisHour = parseInt(parisFmt.format(d), 10);
  const utcHour = parseInt(utcFmt.format(d), 10);
  let offset = parisHour - utcHour;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  return offset;
}

function* candidateSlots(start: Date, daysAhead: number) {
  // Generate 9:00, 11:00, 14:00, 16:00 slots Paris-time on each weekday.
  // Yield ISO strings with explicit Paris UTC offset (e.g. +02:00) so the
  // wall-clock hour in the ISO matches the label shown to the LLM — this
  // prevents the model from reconstructing a wrong UTC ISO when booking.
  const hours = [9, 11, 14, 16];
  const parisFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  for (let day = 1; day <= daysAhead; day++) {
    const d = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
    if (!isWeekday(d)) continue;
    const offset = parisUtcOffset(d); // 2 for CEST, 1 for CET
    const dateStr = parisFmt.format(d); // Paris-local YYYY-MM-DD
    const offsetStr = `+${String(offset).padStart(2, '0')}:00`;
    for (const h of hours) {
      yield `${dateStr}T${String(h).padStart(2, '0')}:00:00${offsetStr}`;
    }
  }
}

/**
 * Resolve a slot ISO string coming back from the LLM to a real offered candidate.
 *
 * The model frequently corrupts the offered ISO when echoing it (drops the
 * `+02:00` Paris offset → time reads as UTC and shifts +2h, and/or hallucinates
 * the year). We never trust its timestamp: instead we regenerate the deterministic
 * candidate slots and snap to the one matching the model's Paris wall-clock
 * (month + day + hour), which is unique within the booking horizon. This recovers
 * the correct full ISO (right year + right offset) regardless of how the model
 * mangled the string.
 *
 * Returns the canonical candidate ISO, or null if no candidate matches.
 */
export function resolveSlotIso(modelIso: string): string | null {
  // Extract the literal date/hour digits the model emitted. Even when it mangles
  // the offset or year, it echoes the MM-DD and HH from the label it was shown.
  const m = modelIso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):/);
  if (!m) return null;
  const wantMonth = m[2];
  const wantDay = m[3];
  const wantHour = m[4];

  // Generate every deterministic candidate over the widest supported horizon so
  // the match is independent of busy-filtering and preferredTimeline.
  for (const iso of candidateSlots(new Date(), 56)) {
    const c = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):/);
    if (!c) continue;
    if (c[2] === wantMonth && c[3] === wantDay && c[4] === wantHour) {
      return iso;
    }
  }
  return null;
}

export async function getAvailableSlots(args: {
  calendarId: string;
  preferredTimeline: string | null;
  count: number;
}): Promise<string[]> {
  const auth = getAuth();
  const horizonDays = inferHorizon(args.preferredTimeline);

  // Mock mode: no Google creds → return deterministic-ish future slots
  if (!auth) {
    const out: string[] = [];
    for (const s of candidateSlots(new Date(), horizonDays)) {
      out.push(s);
      if (out.length >= args.count) break;
    }
    return out;
  }

  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const horizonEnd = new Date(
    now.getTime() + horizonDays * 24 * 60 * 60 * 1000
  );

  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: horizonEnd.toISOString(),
      timeZone: TZ,
      items: [{ id: args.calendarId }]
    }
  });
  const busy = fb.data.calendars?.[args.calendarId]?.busy ?? [];

  const out: string[] = [];
  for (const s of candidateSlots(now, horizonDays)) {
    const slotDate = new Date(s);
    const end = new Date(slotDate.getTime() + 60 * 60 * 1000);
    const overlaps = busy.some((b) => {
      const bs = new Date(b.start!);
      const be = new Date(b.end!);
      return slotDate < be && end > bs;
    });
    if (!overlaps) {
      out.push(s);
      if (out.length >= args.count) break;
    }
  }
  return out;
}

export async function createCalendarEvent(args: {
  calendarId: string;
  slotIso: string;
  contactEmail: string;
  contactName?: string | null;
  listing: Listing;
  details?: string; // free-form qualification summary for the agent
}): Promise<string> {
  const auth = getAuth();
  if (!auth) {
    return `mock-event-${Date.now()}`;
  }

  const calendar = google.calendar({ version: 'v3', auth });
  const start = new Date(args.slotIso);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const who = args.contactName ?? args.contactEmail;
  const res = await calendar.events.insert({
    calendarId: args.calendarId,
    requestBody: {
      summary: `Visite — ${args.listing.title} — ${who}`,
      description: [
        `Prospect: ${who} (${args.contactEmail})`,
        `Bien: ${args.listing.title}`,
        args.details ?? ''
      ]
        .filter(Boolean)
        .join('\n'),
      location: args.listing.address,
      start: { dateTime: start.toISOString(), timeZone: TZ },
      end: { dateTime: end.toISOString(), timeZone: TZ },
      attendees: [{ email: args.contactEmail }]
    }
  });
  return res.data.id ?? '';
}

function inferHorizon(timeline: string | null): number {
  if (!timeline) return 21;
  const t = timeline.toLowerCase();
  if (/(week|semaine)/.test(t)) return 14;
  if (/(month|mois)/.test(t)) return 28;
  if (/(year|an|année)/.test(t)) return 56;
  return 21;
}

export async function deleteCalendarEvent(args: {
  calendarId: string;
  eventId: string;
}): Promise<void> {
  const auth = getAuth();
  if (!auth) return;
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    await calendar.events.delete({ calendarId: args.calendarId, eventId: args.eventId });
  } catch (e) {
    console.warn('[calendar] deleteCalendarEvent failed (may already be deleted):', e);
  }
}
