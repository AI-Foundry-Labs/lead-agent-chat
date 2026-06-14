'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { useLang } from '@/components/lang-provider';

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const next = params.get('next') || '/admin';

  useEffect(() => {
    const code = params.get('error');
    if (code === 'google') setError(t.login_google_error);
    if (code === 'google_not_allowed') setError(t.login_google_not_allowed);
    if (code === 'google_unconfigured') setError(t.login_google_unconfigured);
  }, [params, t]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      if (data.admin?.preferred_lang) {
        document.cookie = `lang=${data.admin.preferred_lang};path=/;max-age=31536000`;
      }
      router.push(next);
      router.refresh();
    } else {
      setError(t.login_error);
    }
  }

  return (
    <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md border-border/80 p-8 shadow-[var(--shadow-elevated)]">
        <div className="mb-6 space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-brand">Admin</p>
          <h1 className="font-display text-2xl font-semibold">{t.login_title}</h1>
          <p className="text-sm text-muted-foreground">{t.login_subtitle}</p>
        </div>

        <div className="space-y-4">
          <GoogleSignInButton intent="admin" next={next} label={t.login_google} />

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border/80" aria-hidden />
            <span className="text-xs text-muted-foreground">{t.login_or_email}</span>
            <span className="h-px flex-1 bg-border/80" aria-hidden />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="admin-email" className="text-sm font-medium">
                {t.email_ph}
              </label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.email_ph}
                className="min-h-11 w-full rounded-xl border border-input bg-background px-4 py-2.5 text-base outline-none transition focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="admin-password" className="text-sm font-medium">
                {t.password_ph}
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.password_ph}
                className="min-h-11 w-full rounded-xl border border-input bg-background px-4 py-2.5 text-base outline-none transition focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
                required
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              type="submit"
              className="min-h-11 w-full rounded-xl bg-brand text-brand-foreground hover:bg-brand/90"
              disabled={busy}
            >
              {busy ? '…' : t.login_btn}
            </Button>
          </form>
        </div>
      </Card>
    </main>
  );
}
