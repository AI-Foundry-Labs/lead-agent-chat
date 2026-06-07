import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getLeadIdFromCookies } from '@/lib/auth';
import { ThreadsList } from '@/components/chat/threads-list';
import { getLang } from '@/lib/i18n-server';
import { getDict } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function ThreadsPage() {
  const leadId = await getLeadIdFromCookies();
  if (!leadId) redirect('/login?next=/threads');

  const lang = await getLang();
  const t = getDict(lang);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t.back_all.replace('← ', '')}
        </Link>
      </div>

      <header className="mb-8 space-y-2">
        <h1 className="font-display text-3xl font-semibold">{t.threads_title}</h1>
        <p className="text-muted-foreground">{t.threads_subtitle}</p>
      </header>

      <ThreadsList />
    </main>
  );
}
