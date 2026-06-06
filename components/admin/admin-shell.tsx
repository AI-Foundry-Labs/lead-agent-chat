'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { AdminTabNav } from '@/components/admin/admin-tab-nav';
import { AdminAssistant } from '@/components/admin/admin-assistant';
import { DashboardPanel } from '@/components/admin/dashboard-panel';
import { ConversationsPanel } from '@/components/admin/conversations-panel';
import { ConfigPanel } from '@/components/admin/config-panel';
import type { AdminData } from '@/components/admin/admin-types';

type Tab = 'assistant' | 'dashboard' | 'conversations' | 'config';

export function AdminShell() {
  const { t } = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/admin/data');
    if (res.status === 401) {
      router.push('/admin/login');
      router.refresh();
      return;
    }
    if (!res.ok) {
      setError('load_failed');
      setLoading(false);
      return;
    }
    setData(await res.json());
    setLoading(false);
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch();
  }, [refetch]);

  async function logout() {
    await fetch('/api/auth/admin/logout', { method: 'POST' });
    router.push('/admin/login');
    router.refresh();
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'assistant', label: t.tab_assistant },
    { key: 'dashboard', label: t.tab_dashboard },
    { key: 'conversations', label: t.tab_conversations },
    { key: 'config', label: t.tab_config }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AdminTabNav tabs={tabs} active={tab} onChange={setTab} />
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          {t.logout}
        </Button>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load admin data.
        </p>
      )}

      {loading && !data && (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-48 animate-pulse rounded-xl bg-muted" />
        </div>
      )}

      {tab === 'assistant' && <AdminAssistant />}
      {tab === 'dashboard' && <DashboardPanel data={data} />}
      {tab === 'conversations' && (
        <ConversationsPanel data={data} onChanged={refetch} />
      )}
      {tab === 'config' && <ConfigPanel data={data} onChanged={refetch} />}
    </div>
  );
}
