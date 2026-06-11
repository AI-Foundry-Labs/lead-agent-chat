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
  const hours = [9, 11, 14, 16];
  for (let day = 1; day <= daysAhead; day++) {
    const d = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
    if (!isWeekday(d)) continue;
    const offset = parisUtcOffset(d); // e.g. 2 for CEST, 1 for CET
    for (const h of hours) {
      const slot = new Date(d);
      slot.setUTCHours(h - offset, 0, 0, 0);
      yield slot;
    }
  }
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
      out.push(s.toISOString());
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
    const end = new Date(s.getTime() + 60 * 60 * 1000);
    const overlaps = busy.some((b) => {
      const bs = new Date(b.start!);
      const be = new Date(b.end!);
      return s < be && end > bs;
    });
    if (!overlaps) {
      out.push(s.toISOString());
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
