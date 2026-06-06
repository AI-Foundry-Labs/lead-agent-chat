'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function LeadLogin({
  prominent = false,
  className
}: {
  prominent?: boolean;
  className?: string;
}) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function request() {
    if (!email.trim()) return;
    const res = await fetch('/api/auth/lead-request-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), lang })
    });
    const data = await res.json().catch(() => ({}));
    setSent(true);
    if (data.dev_link) setDevLink(data.dev_link);
  }

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant={prominent ? 'default' : 'ghost'}
        size={prominent ? 'default' : 'sm'}
        className={cn(
          prominent && 'rounded-full bg-brand text-brand-foreground hover:bg-brand/90',
          className
        )}
      >
        <Mail className="size-4" aria-hidden />
        {t.login}
      </Button>
    );
  }

  if (sent) {
    return (
      <div
        className={cn(
          prominent
            ? 'max-w-sm rounded-2xl border border-border/80 bg-card p-4 text-sm text-muted-foreground shadow-[var(--shadow-elevated)]'
            : 'text-xs text-muted-foreground',
          className
        )}
      >
        {t.login_sent}
        {devLink && (
          <a href={devLink} className="mt-2 block break-all text-brand underline underline-offset-2">
            {t.login_dev} {devLink}
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        prominent
          ? 'flex w-full max-w-sm flex-col gap-2 rounded-2xl border border-border/80 bg-card p-3 shadow-[var(--shadow-elevated)] sm:flex-row sm:items-center'
          : 'flex items-center gap-2',
        className
      )}
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t.login_email_prompt}
        aria-label={t.login_email_prompt}
        className={cn(
          'min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20',
          !prominent && 'w-44 text-sm'
        )}
      />
      <Button
        type="button"
        onClick={() => void request()}
        className="min-h-11 rounded-xl bg-brand text-brand-foreground hover:bg-brand/90"
      >
        {t.login_send}
      </Button>
    </div>
  );
}
