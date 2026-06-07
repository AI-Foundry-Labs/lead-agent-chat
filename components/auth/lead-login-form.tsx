'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CircleCheck, Mail } from 'lucide-react';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { cn } from '@/lib/utils';

export function LeadLoginForm({ className }: { className?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { t, lang } = useLang();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const next = params.get('next') || '/';

  async function request() {
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    const res = await fetch('/api/auth/lead-request-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), lang })
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      const code = data.error as string | undefined;
      setError(
        code === 'invalid_email'
          ? t.login_email_invalid
          : code === 'email_not_configured'
            ? t.login_email_unconfigured
            : t.login_email_send_error
      );
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <Card
        className={cn(
          'overflow-hidden border-border/80 p-8 shadow-[var(--shadow-elevated)]',
          className
        )}
      >
        <div
          className="flex flex-col items-center text-center"
          role="status"
          aria-live="polite"
        >
          <div
            className="mb-5 flex size-16 items-center justify-center rounded-full bg-emerald-50 ring-[10px] ring-emerald-50/70"
            aria-hidden
          >
            <CircleCheck className="size-8 text-emerald-600" strokeWidth={1.75} />
          </div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            {t.login_sent_title}
          </h2>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {t.login_sent_to(email.trim())}
          </p>
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground/80">
            {t.login_sent_spam}
          </p>
          <Button
            variant="outline"
            className="mt-8 min-h-11 w-full rounded-xl"
            onClick={() => router.push(next)}
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t.login_back}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'space-y-4 border-border/80 p-6 shadow-[var(--shadow-elevated)]',
        className
      )}
    >
      <GoogleSignInButton intent="lead" next={next} label={t.login_google} />

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border/80" aria-hidden />
        <span className="text-xs text-muted-foreground">{t.login_or_email}</span>
        <span className="h-px flex-1 bg-border/80" aria-hidden />
      </div>

      <div className="space-y-2">
        <label htmlFor="lead-login-email" className="text-sm font-medium">
          {t.email_ph}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="lead-login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.login_email_prompt}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
          />
          <Button
            type="button"
            onClick={() => void request()}
            className="min-h-11 rounded-xl bg-brand text-brand-foreground hover:bg-brand/90"
            disabled={busy || !email.trim()}
          >
            <Mail className="size-4" aria-hidden />
            {busy ? '…' : t.login_send}
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Card>
  );
}

export function LeadLoginFormSuspense(props: { className?: string }) {
  return (
    <Suspense>
      <LeadLoginForm {...props} />
    </Suspense>
  );
}
