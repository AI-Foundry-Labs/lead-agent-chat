'use client';

import { useState } from 'react';
import { Home, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AdminSection } from '@/components/admin/admin-section';
import { ListingImageUpload } from '@/components/admin/listing-image-upload';
import { adminAction, type AdminData } from '@/components/admin/admin-types';
import { cn } from '@/lib/utils';

const inputClass =
  'min-h-10 rounded-lg border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 sm:text-sm';

const MOCK_LISTING_IMAGE =
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80';

const emptyListing = {
  id: '',
  title: '',
  address: '',
  price: '',
  rooms: '',
  surface_m2: '',
  floor: '',
  description: '',
  features: '',
  image_url: ''
};

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function splitFeatures(value: string, fallback: string[]): string[] {
  const features = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return features.length ? features : fallback;
}

export function ListingsPanel({
  data,
  onChanged
}: {
  data: AdminData | null;
  onChanged: () => void;
}) {
  const { t } = useLang();
  const [nl, setNl] = useState(emptyListing);

  async function addListing() {
    const title = nl.title.trim();
    const id = (nl.id.trim() || slugify(title)).slice(0, 50);
    if (!id || !title) return;

    const rooms = Number(nl.rooms) || 1;
    const surface = Number(nl.surface_m2) || 1;
    const floor = nl.floor.trim() || 'Étage à préciser';
    const description = nl.description.trim() || title;
    const features = splitFeatures(nl.features, [
      `${rooms} pièce${rooms > 1 ? 's' : ''}`,
      `${surface} m²`,
      floor
    ]);

    await adminAction({
      kind: 'create_listing',
      listing: {
        id,
        title,
        title_en: title,
        address: nl.address.trim() || 'Adresse à préciser',
        price: Number(nl.price) || 0,
        surface_m2: surface,
        rooms,
        floor,
        floor_en: floor,
        description,
        description_en: description,
        key_features: features,
        key_features_en: features,
        image_url: nl.image_url.trim() || MOCK_LISTING_IMAGE,
        agent_name: 'Agence Lumière',
        agent_email: 'contact@agence-lumiere.fr',
        agent_calendar_id: 'primary'
      }
    });
    setNl(emptyListing);
    onChanged();
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      <AdminSection title={t.cfg_listings}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.listings.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/80 bg-card p-2 text-sm"
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                {l.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.image_url}
                    alt={l.title}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="size-5" aria-hidden />
                  </div>
                )}
              </div>
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {l.address} · {l.id}
                </span>
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t.cfg_delete}
                onClick={async () => {
                  await adminAction({ kind: 'delete_listing', id: l.id });
                  onChanged();
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      </AdminSection>

      <AdminSection title={t.listing_add}>
        <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border/80 bg-card lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            <input
              value={nl.title}
              onChange={(e) => {
                const title = e.target.value;
                setNl((current) => ({
                  ...current,
                  title,
                  id: current.id ? current.id : slugify(title)
                }));
              }}
              placeholder={t.listing_title_ph}
              aria-label={t.listing_title_ph}
              className={cn(inputClass, 'sm:col-span-2')}
            />
            <input
              value={nl.id}
              onChange={(e) => setNl({ ...nl, id: slugify(e.target.value) })}
              placeholder="slug-url"
              aria-label="Slug URL"
              className={inputClass}
            />
            <input
              value={nl.address}
              onChange={(e) => setNl({ ...nl, address: e.target.value })}
              placeholder={t.listing_address_ph}
              aria-label={t.listing_address_ph}
              className={inputClass}
            />
            <input
              inputMode="numeric"
              value={nl.price}
              onChange={(e) => setNl({ ...nl, price: e.target.value })}
              placeholder={t.listing_price_ph}
              aria-label={t.listing_price_ph}
              className={inputClass}
            />
            <input
              inputMode="numeric"
              value={nl.surface_m2}
              onChange={(e) => setNl({ ...nl, surface_m2: e.target.value })}
              placeholder={t.listing_surface_ph}
              aria-label={t.listing_surface_ph}
              className={inputClass}
            />
            <input
              inputMode="numeric"
              value={nl.rooms}
              onChange={(e) => setNl({ ...nl, rooms: e.target.value })}
              placeholder={t.listing_rooms_ph}
              aria-label={t.listing_rooms_ph}
              className={inputClass}
            />
            <input
              value={nl.floor}
              onChange={(e) => setNl({ ...nl, floor: e.target.value })}
              placeholder={t.listing_floor_ph}
              aria-label={t.listing_floor_ph}
              className={inputClass}
            />
            <ListingImageUpload
              value={nl.image_url}
              onChange={(image_url) => setNl({ ...nl, image_url })}
            />
            <textarea
              value={nl.description}
              onChange={(e) => setNl({ ...nl, description: e.target.value })}
              placeholder={t.listing_description_ph}
              aria-label={t.listing_description_ph}
              className={cn(inputClass, 'min-h-28 resize-y sm:col-span-2')}
            />
            <input
              value={nl.features}
              onChange={(e) => setNl({ ...nl, features: e.target.value })}
              placeholder={t.listing_features_ph}
              aria-label={t.listing_features_ph}
              className={cn(inputClass, 'sm:col-span-2')}
            />
            <Button
              className="bg-brand text-brand-foreground hover:bg-brand/90 sm:col-span-2"
              onClick={() => void addListing()}
              disabled={!nl.title.trim()}
            >
              <Plus className="size-4" aria-hidden />
              {t.cfg_add}
            </Button>
          </div>

          <div className="border-t border-border/80 bg-surface/60 p-4 lg:border-l lg:border-t-0">
            <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-card)]">
              <div className="relative aspect-[4/3] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={nl.image_url.trim() || MOCK_LISTING_IMAGE}
                  alt={nl.title || 'Listing preview'}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {!nl.image_url.trim() && (
                  <Badge className="absolute left-3 top-3 border-0 bg-white/95 text-foreground">
                    {t.listing_upload_mock}
                  </Badge>
                )}
              </div>
              <div className="space-y-2 p-4">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-brand">
                  <Home className="size-3.5" aria-hidden />
                  Preview
                </p>
                <h4 className="font-display text-lg font-semibold leading-tight">
                  {nl.title || t.listing_new}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {nl.address || t.listing_address_ph}
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{nl.rooms || '1'} {t.rooms}</Badge>
                  <Badge variant="outline">{nl.surface_m2 || '1'} m²</Badge>
                  <Badge variant="outline">{nl.floor || t.listing_floor_ph}</Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AdminSection>
    </div>
  );
}
