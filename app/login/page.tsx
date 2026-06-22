import { LeadLoginFormSuspense } from '@/components/auth/lead-login-form';
import { DevLeadShortcuts } from '@/components/auth/dev-lead-shortcuts';
import { getLang } from '@/lib/i18n-server';
import { getDict } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const t = getDict(await getLang());
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 space-y-2 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-brand">
          {t.brand}
        </p>
        <h1 className="font-display text-2xl font-semibold">{t.login_page_title}</h1>
        <p className="text-sm text-muted-foreground">{t.login_page_subtitle}</p>
      </div>
      {isDev && <div className="mb-3"><DevLeadShortcuts /></div>}
      <LeadLoginFormSuspense />
    </main>
  );
}
