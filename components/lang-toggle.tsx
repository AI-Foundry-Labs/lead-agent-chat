'use client';

import { useLang } from '@/components/lang-provider';
import { cn } from '@/lib/utils';

export function LangToggle() {
  const { lang, setLang, t } = useLang();

  return (
    <div
      className="inline-flex overflow-hidden rounded-lg border border-border/80 bg-surface/60 p-0.5 text-xs"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => setLang('fr')}
        className={cn(
          'min-h-9 min-w-10 rounded-md px-3 py-1.5 font-medium transition',
          lang === 'fr' ? 'bg-brand text-brand-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
        )}
        aria-pressed={lang === 'fr'}
      >
        {t.lang_fr}
      </button>
      <button
        type="button"
        onClick={() => setLang('en')}
        className={cn(
          'min-h-9 min-w-10 rounded-md px-3 py-1.5 font-medium transition',
          lang === 'en' ? 'bg-brand text-brand-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
        )}
        aria-pressed={lang === 'en'}
      >
        {t.lang_en}
      </button>
    </div>
  );
}
