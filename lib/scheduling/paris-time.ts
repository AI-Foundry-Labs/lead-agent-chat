/**
 * Europe/Paris wall-clock ↔ UTC conversion (F4a). Admins schedule in local Paris
 * time; we store UTC. Intl-based — no date library (none in package.json).
 * Handles CET (+1) / CEST (+2) automatically including DST boundaries.
 */

// Offset (ms) of Europe/Paris from UTC at a given instant. Positive = ahead of UTC.
function parisOffsetMs(d: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(d);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value);
  // 'en-US' emits hour 24 for midnight — normalise to 0.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asUtc - d.getTime();
}

/**
 * Parse a Paris wall-clock datetime ("YYYY-MM-DD HH:MM" or with 'T') → UTC Date.
 * Returns null if the string is malformed.
 */
export function parisLocalToUtc(local: string): Date | null {
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Interpret the wall-clock parts as if UTC, then shift back by the Paris offset
  // computed at that approximate instant (correct across DST within one step).
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = parisOffsetMs(new Date(guess));
  const utc = new Date(guess - offset);
  return isNaN(utc.getTime()) ? null : utc;
}

/** Format a UTC Date as a readable Europe/Paris wall-clock string. */
export function utcToParisLabel(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(d);
}
