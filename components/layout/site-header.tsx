'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LangToggle } from '@/components/lang-toggle';
import { LeadAuthNav } from '@/components/layout/lead-auth-nav';
import { getDict, type Lang } from '@/lib/i18n';

export function SiteHeader({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const t = getDict(lang);

  if (pathname.startsWith('/admin')) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
        <Link href="/" className="group flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-brand-foreground shadow-[var(--shadow-glow)] transition group-hover:scale-105"
          >
            L
          </span>
          <span className="font-display text-base font-semibold tracking-tight">{t.brand}</span>
        </Link>

        <nav className="flex items-center gap-3" aria-label="Main">
          <Link
            href="/"
            className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground sm:inline-block"
          >
            {t.nav_listings}
          </Link>
          <LeadAuthNav />
          <LangToggle />
        </nav>
      </div>
    </header>
  );
}
