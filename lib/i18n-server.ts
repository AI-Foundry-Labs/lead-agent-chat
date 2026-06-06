import { cookies } from 'next/headers';
import { LANG_COOKIE, normalizeLang, type Lang } from '@/lib/i18n';

// Server-only: read the chosen language from the cookie for server components.
export async function getLang(): Promise<Lang> {
  const jar = await cookies();
  return normalizeLang(jar.get(LANG_COOKIE)?.value);
}
