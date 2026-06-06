'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AdminAssistant } from '@/components/admin/admin-assistant';
import { DashboardPanel } from '@/components/admin/dashboard-panel';
import { ConversationsPanel } from '@/components/admin/conversations-panel';
import { ConfigPanel } from '@/components/admin/config-panel';
import type { AdminData } from '@/components/admin/admin-types';

type Tab = 'assistant' | 'dashboard' | 'conversations' | 'config';

export function AdminShell() {
  const { t } = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('assistant');
  const [data, setData] = useState<AdminData | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch('/api/admin/data');
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // Fetch-on-mount; setData runs after the await, not synchronously.
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-lg border p-1">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                tab === tb.key
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-muted'
              )}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          {t.logout}
        </Button>
      </div>

      {tab === 'assistant' && <AdminAssistant />}
      {tab === 'dashboard' && <DashboardPanel data={data} />}
      {tab === 'conversations' && (
        <ConversationsPanel data={data} onChanged={refetch} />
      )}
      {tab === 'config' && <ConfigPanel data={data} onChanged={refetch} />}
    </div>
  );
}
