import { AdminShell } from '@/components/admin/admin-shell';
import { getLang } from '@/lib/i18n-server';
import { getDict } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const t = getDict(await getLang());
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">{t.admin_space}</h1>
      <AdminShell />
    </main>
  );
}
