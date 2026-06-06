import { listListings } from '@/lib/db';
import { ListingCard } from '@/components/listings/listing-card';
import { getLang } from '@/lib/i18n-server';
import { getDict } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const lang = await getLang();
  const t = getDict(lang);
  const listings = await listListings();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t.brand}</h1>
        <p className="mt-1 text-muted-foreground">{t.home_subtitle}</p>
      </header>

      {listings.length === 0 ? (
        <p className="text-muted-foreground">
          {t.home_empty} <code className="rounded bg-muted px-1">npm run db:seed</code>.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} lang={lang} />
          ))}
        </div>
      )}
    </main>
  );
}
