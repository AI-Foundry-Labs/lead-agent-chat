'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLang } from '@/components/lang-provider';
import {
  getPendingConversationIds,
  removePendingConversationIds
} from '@/components/chat/pending-conversation-ids';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type LeadSession = {
  authenticated: boolean;
  email?: string | null;
  name?: string | null;
};

export function LeadAuthNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLang();
  const [session, setSession] = useState<LeadSession | null>(null);

  async function claimPendingConversations() {
    const ids = getPendingConversationIds();
    if (ids.length === 0) return;
    const res = await fetch('/api/chat/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationIds: ids })
    });
    if (!res.ok) return;
    const data = (await res.json()) as { claimed?: string[] };
    if (data.claimed?.length) removePendingConversationIds(data.claimed);
  }

  useEffect(() => {
    fetch('/api/auth/lead/me')
      .then((r) => r.json())
      .then((data: LeadSession) => {
        setSession(data);
        if (data.authenticated) void claimPendingConversations();
      })
      .catch(() => setSession({ authenticated: false }));
  }, [pathname]);

  async function logout() {
    await fetch('/api/auth/lead-logout', { method: 'POST' });
    setSession({ authenticated: false });
    router.refresh();
  }

  if (session === null) {
    return (
      <span
        className={cn('inline-block h-9 w-16 animate-pulse rounded-lg bg-muted', className)}
        aria-hidden
      />
    );
  }

  if (session.authenticated) {
    const label = session.name ?? session.email ?? t.logged_in;
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Link
          href="/threads"
          className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground sm:inline-block"
        >
          {t.nav_threads}
        </Link>
        <span className="hidden max-w-[10rem] truncate text-sm text-muted-foreground md:inline">
          {label}
        </span>
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          {t.logout}
        </Button>
      </div>
    );
  }

  if (pathname === '/login') return null;

  const next = encodeURIComponent(pathname);
  return (
    <Link
      href={`/login?next=${next}`}
      className={cn(
        'inline-flex min-h-9 items-center rounded-lg border border-border/80 px-3 py-1.5 text-sm font-medium transition hover:bg-muted',
        className
      )}
    >
      {t.login}
    </Link>
  );
}
