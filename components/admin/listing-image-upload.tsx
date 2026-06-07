'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Upload, X } from 'lucide-react';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ACCEPT = 'image/jpeg,image/png,image/webp';

export function ListingImageUpload({
  value,
  onChange,
  className
}: {
  value: string;
  onChange: (url: string) => void;
  className?: string;
}) {
  const { t } = useLang();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/admin/upload-listing-image', {
        method: 'POST',
        body
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t.listing_upload_error);
        return;
      }
      if (typeof data.url === 'string') onChange(data.url);
    } catch {
      setError(t.listing_upload_error);
    } finally {
      setUploading(false);
    }
  }

  function pickFile(file: File | undefined) {
    if (!file || uploading) return;
    void upload(file);
  }

  return (
    <div className={cn('space-y-2 sm:col-span-2', className)}>
      <p className="text-sm font-medium">{t.listing_image_label}</p>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFile(e.dataTransfer.files[0]);
        }}
        className={cn(
          'relative flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition',
          dragOver
            ? 'border-brand bg-brand/5'
            : 'border-border/80 bg-surface/40 hover:border-brand/50 hover:bg-surface/70',
          uploading && 'pointer-events-none opacity-70'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label={t.listing_upload_pick}
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {uploading ? (
          <>
            <Loader2 className="size-8 animate-spin text-brand" aria-hidden />
            <p className="text-sm text-muted-foreground">{t.listing_uploading}</p>
          </>
        ) : value ? (
          <>
            <div className="relative aspect-[16/10] w-full max-w-xs overflow-hidden rounded-lg border border-border/80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={value} alt="" className="h-full w-full object-cover" />
            </div>
            <p className="max-w-full truncate text-xs text-muted-foreground">{value}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
            >
              <X className="size-4" aria-hidden />
              {t.listing_upload_remove}
            </Button>
          </>
        ) : (
          <>
            <div className="flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Upload className="size-5" aria-hidden />
            </div>
            <p className="text-sm font-medium">{t.listing_upload_drag}</p>
            <p className="text-xs text-muted-foreground">{t.listing_upload_hint}</p>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t.listing_upload_or_url}</span>
        <ImagePlus className="size-3.5 text-muted-foreground" aria-hidden />
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.listing_image_ph}
        aria-label={t.listing_image_ph}
        className="min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 sm:text-sm"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
