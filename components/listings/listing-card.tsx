import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/format';
import { getDict, type Lang } from '@/lib/i18n';
import type { Listing } from '@/lib/types';
import { ArrowUpRight } from 'lucide-react';

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
    <Link href={`/listings/${listing.id}`} className="group block animate-fade-up">
      <Card className="overflow-hidden border-border/80 p-0 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[var(--shadow-elevated)]">
        <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-accent to-muted">
          {listing.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.image_url}
              alt={title}
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/5 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-2 p-4">
            <Badge variant="secondary" className="border-0 bg-white/95 text-foreground backdrop-blur-sm">
              {listing.rooms} {t.rooms} · {listing.surface_m2} m²
            </Badge>
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-full bg-white/95 text-foreground opacity-0 transition group-hover:opacity-100"
            >
              <ArrowUpRight className="size-4" />
            </span>
          </div>
        </div>
        <div className="space-y-2 p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-lg font-semibold leading-snug">{title}</h3>
            <p className="shrink-0 font-display text-lg font-semibold text-brand">
              {formatPrice(listing.price, lang)}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">{listing.address}</p>
        </div>
      </Card>
    </Link>
  );
}
