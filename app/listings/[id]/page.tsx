import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getListingById } from '@/lib/db';
import { ChatPanel } from '@/components/chat/chat-panel';
import { LeadLogin } from '@/components/chat/lead-login';
import {
  ListingFeaturesList,
  ListingHeroImage,
  ListingSpecBadges
} from '@/components/listings/listing-detail-parts';
import { formatPrice } from '@/lib/format';
import { getLang } from '@/lib/i18n-server';
import { getDict } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function ListingPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLang();
  const t = getDict(lang);
  const listing = await getListingById(id);
  if (!listing) notFound();

  const en = lang === 'en';
  const title = en ? listing.title_en : listing.title;
  const floor = en ? listing.floor_en : listing.floor;
  const description = en ? listing.description_en : listing.description;
  const features = en ? listing.key_features_en : listing.key_features;
  const greeting = t.greeting(title);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t.back_all.replace('← ', '')}
        </Link>
        <LeadLogin prominent />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10">
        <article className="space-y-6 animate-fade-up">
          <ListingHeroImage listing={listing} title={title} />
          <ListingSpecBadges listing={listing} floor={floor} lang={lang} />
          <div className="space-y-2">
            <h1 className="font-display text-3xl font-semibold leading-tight">{title}</h1>
            <p className="text-muted-foreground">{listing.address}</p>
            <p className="font-display text-2xl font-semibold text-brand">
              {formatPrice(listing.price, lang)}
            </p>
          </div>
          <p className="max-w-prose text-base leading-relaxed text-foreground/85">{description}</p>
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold">{t.key_features}</h2>
            <ListingFeaturesList features={features} />
          </div>
        </article>

        <aside className="lg:sticky lg:top-20 lg:self-start animate-fade-up-delay-1">
          <ChatPanel listingId={listing.id} greeting={greeting} />
        </aside>
      </div>
    </main>
  );
}
