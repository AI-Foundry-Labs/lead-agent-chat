'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { useLang } from '@/components/lang-provider';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatThreadDate } from '@/lib/format';

type Thread = {
  id: string;
  listing_id: string | null;
  listing_title: string | null;
  mode: string;
  preview: string | null;
  updated_at: string;
};

export function ThreadsList() {
  const { t, lang } = useLang();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/chat/threads')
      .then((r) => {
        if (!r.ok) throw new Error('fetch failed');
        return r.json();
      })
      .then((data: { threads: Thread[] }) => setThreads(data.threads))
      .catch(() => setError(true));
  }, []);

  if (threads === null && !error) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-border/80 p-6 text-sm text-muted-foreground">
        {t.threads_error}
      </Card>
    );
  }

  if (!threads?.length) {
    return (
      <Card className="border-dashed border-border/80 p-8 text-center">
        <MessageSquare className="mx-auto mb-3 size-8 text-muted-foreground/60" aria-hidden />
        <p className="text-sm text-muted-foreground">{t.threads_empty}</p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm font-medium text-brand underline-offset-2 hover:underline"
        >
          {t.threads_browse}
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {threads.map((thread) => (
        <Link
          key={thread.id}
          href={`/threads/${thread.id}`}
          className="block rounded-xl border border-border/80 bg-card p-4 shadow-[var(--shadow-card)] transition hover:border-brand/30 hover:bg-brand/5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {thread.listing_title ?? t.threads_untitled}
              </p>
              {thread.preview && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {thread.preview}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {formatThreadDate(thread.updated_at, lang)}
              </p>
            </div>
            {thread.mode === 'manual' && (
              <Badge variant="warning" className="shrink-0">
                {t.threads_manual}
              </Badge>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
