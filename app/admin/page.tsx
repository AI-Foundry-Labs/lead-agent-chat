import { AdminShell } from '@/components/admin/admin-shell';
import { PageHeader } from '@/components/layout/page-header';
import { getLang } from '@/lib/i18n-server';
import { getDict } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const t = getDict(await getLang());
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <PageHeader title={t.admin_space} subtitle={t.assistant_examples} className="mb-8" />
      <AdminShell />
    </main>
  );
}
