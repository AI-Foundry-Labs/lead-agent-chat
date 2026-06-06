import { listListings } from '@/lib/db';
import { ListingCard } from '@/components/listings/listing-card';
import { PageHeader } from '@/components/layout/page-header';
import { getLang } from '@/lib/i18n-server';
import { getDict } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const lang = await getLang();
  const t = getDict(lang);
  const listings = await listListings();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <PageHeader
        eyebrow={t.home_eyebrow}
        title={t.brand}
        subtitle={t.home_subtitle}
        className="animate-fade-up"
      />

      {listings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/50 px-6 py-12 text-center">
          <p className="text-muted-foreground">
            {t.home_empty}{' '}
            <code className="rounded-md bg-muted px-2 py-0.5 text-sm">npm run db:seed</code>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l, i) => (
            <div
              key={l.id}
              className={i === 0 ? 'animate-fade-up-delay-1 sm:col-span-2 lg:col-span-1' : 'animate-fade-up-delay-2'}
            >
              <ListingCard listing={l} lang={lang} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
