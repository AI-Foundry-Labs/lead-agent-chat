'use client';

import { useLang } from '@/components/lang-provider';
import { cn } from '@/lib/utils';

export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex overflow-hidden rounded-md border text-xs">
      <button
        type="button"
        onClick={() => setLang('fr')}
        className={cn('px-2 py-1', lang === 'fr' ? 'bg-neutral-900 text-white' : 'bg-white')}
        aria-pressed={lang === 'fr'}
      >
        FR
      </button>
      <button
        type="button"
        onClick={() => setLang('en')}
        className={cn('px-2 py-1', lang === 'en' ? 'bg-neutral-900 text-white' : 'bg-white')}
        aria-pressed={lang === 'en'}
      >
        EN
      </button>
    </div>
  );
}
