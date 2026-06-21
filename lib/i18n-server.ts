import { cookies } from 'next/headers';
import { LANG_COOKIE, normalizeLang, type Lang } from '@/lib/i18n';

// NEXT_PUBLIC_FORCE_LANG locks the UI to a single language (no toggle).
const FORCED_LANG = process.env.NEXT_PUBLIC_FORCE_LANG
  ? normalizeLang(process.env.NEXT_PUBLIC_FORCE_LANG)
  : null;

// Server-only: read the chosen language from the cookie for server components.
export async function getLang(): Promise<Lang> {
  if (FORCED_LANG) return FORCED_LANG;
  const jar = await cookies();
  return normalizeLang(jar.get(LANG_COOKIE)?.value);
}

export function getForcedLang(): Lang | null {
  return FORCED_LANG;
}
