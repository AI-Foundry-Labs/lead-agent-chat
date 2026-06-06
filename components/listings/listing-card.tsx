import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/format';
import { getDict, type Lang } from '@/lib/i18n';
import type { Listing } from '@/lib/types';

export function ListingCard({
  listing,
  lang
}: {
  listing: Listing;
  lang: Lang;
}) {
  const t = getDict(lang);
  const title = lang === 'en' ? listing.title_en : listing.title;
  return (
    <Link href={`/listings/${listing.id}`} className="block group">
      <Card className="overflow-hidden p-0 transition-shadow group-hover:shadow-md">
        <div className="relative aspect-[3/2] bg-gradient-to-br from-neutral-200 to-neutral-100">
          {listing.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.image_url}
              alt={title}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute bottom-0 left-0 p-4">
            <Badge variant="secondary" className="bg-white/90">
              {listing.rooms} {t.rooms} · {listing.surface_m2} m²
            </Badge>
          </div>
        </div>
        <div className="p-4 space-y-1">
          <h3 className="font-medium leading-tight">{title}</h3>
          <p className="text-sm text-muted-foreground">{listing.address}</p>
          <p className="pt-1 font-semibold">{formatPrice(listing.price, lang)}</p>
        </div>
      </Card>
    </Link>
  );
}
