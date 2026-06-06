import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getListingById } from '@/lib/db';
import { ChatPanel } from '@/components/chat/chat-panel';
import { Badge } from '@/components/ui/badge';
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
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        {t.back_all}
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px]">
        <article className="space-y-5">
          <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-gradient-to-br from-neutral-200 to-neutral-100">
            {listing.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={listing.image_url}
                alt={title}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {listing.rooms} {t.rooms}
            </Badge>
            <Badge variant="secondary">{listing.surface_m2} m²</Badge>
            <Badge variant="secondary">{floor}</Badge>
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-muted-foreground">{listing.address}</p>
            <p className="mt-2 text-xl font-semibold">
              {formatPrice(listing.price, lang)}
            </p>
          </div>
          <p className="leading-relaxed text-neutral-700">{description}</p>
          <div>
            <h2 className="mb-2 font-medium">{t.key_features}</h2>
            <ul className="grid grid-cols-2 gap-1 text-sm text-neutral-700">
              {features.map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
          </div>
        </article>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <ChatPanel listingId={listing.id} greeting={greeting} />
        </aside>
      </div>
    </main>
  );
}
