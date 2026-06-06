import { Badge } from '@/components/ui/badge';
import { getDict, type Lang } from '@/lib/i18n';
import type { Listing } from '@/lib/types';

export function ListingHeroImage({
  listing,
  title
}: {
  listing: Listing;
  title: string;
}) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-gradient-to-br from-accent to-muted shadow-[var(--shadow-elevated)]">
      {listing.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={listing.image_url}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
    </div>
  );
}

export function ListingSpecBadges({
  listing,
  floor,
  lang
}: {
  listing: Listing;
  floor: string;
  lang: Lang;
}) {
  const t = getDict(lang);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">{listing.rooms} {t.rooms}</Badge>
      <Badge variant="outline">{listing.surface_m2} m²</Badge>
      <Badge variant="outline">{floor}</Badge>
    </div>
  );
}

export function ListingFeaturesList({ features }: { features: string[] }) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {features.map((f) => (
        <li
          key={f}
          className="flex items-start gap-2 rounded-lg border border-border/60 bg-surface/50 px-3 py-2 text-sm text-foreground/90"
        >
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
          {f}
        </li>
      ))}
    </ul>
  );
}
