'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { AdminTabNav } from '@/components/admin/admin-tab-nav';
import { AgentsPanel } from '@/components/admin/agents-panel';
import { DashboardPanel } from '@/components/admin/dashboard-panel';
import { ConversationsPanel } from '@/components/admin/conversations-panel';
import { ListingsPanel } from '@/components/admin/listings-panel';
import { ConfigPanel } from '@/components/admin/config-panel';
import { AssistantPanel } from '@/components/admin/assistant-panel';
import type { AdminData } from '@/components/admin/admin-types';

type Tab = 'agents' | 'dashboard' | 'conversations' | 'listings' | 'config' | 'assistant';
type LinkInfo = { deepLink: string | null; command: string };

export function AdminShell() {
  const { t } = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);

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

  // SSE: subscribe to agency-data-changed events so the dashboard auto-updates
  // when the agent mutates config / listings / handoff rules.
  useEffect(() => {
    const es = new EventSource('/api/admin/stream-agency');
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data as string) as { type: string };
        if (payload.type !== 'agency-data') return;
      } catch {
        return;
      }
      // Debounce: coalesce rapid bursts (e.g. bulk mutations) into a single refetch
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { void refetch(); }, 500);
    };
    es.onerror = () => es.close();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      es.close();
    };
  }, [refetch]);

  async function logout() {
    await fetch('/api/auth/admin/logout', { method: 'POST' });
    router.push('/admin/login');
    router.refresh();
  }

  // Telegram group linking — lives in the header so it's reachable from any tab.
  async function linkTelegram() {
    if (linkInfo) { setLinkInfo(null); return; }
    const res = await fetch('/api/admin/link-telegram', { method: 'POST' });
    const d = await res.json();
    setLinkInfo({ deepLink: d.deep_link ?? null, command: d.command ?? '' });
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'agents', label: t.tab_agents },
    { key: 'dashboard', label: t.tab_dashboard },
    { key: 'conversations', label: t.tab_conversations },
    { key: 'listings', label: t.tab_listings },
    { key: 'config', label: t.tab_config },
    { key: 'assistant', label: t.tab_assistant }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AdminTabNav tabs={tabs} active={tab} onChange={setTab} />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void linkTelegram()}>
            {t.link_telegram}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            {t.logout}
          </Button>
        </div>
      </div>

      {linkInfo && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          {linkInfo.deepLink && (
            <a
              href={linkInfo.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 underline hover:text-blue-800"
            >
              Open Telegram →
            </a>
          )}
          <span>{t.link_info} <code>{linkInfo.command}</code></span>
        </div>
      )}

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

      {tab === 'agents' && <AgentsPanel data={data} />}
      {tab === 'dashboard' && <DashboardPanel data={data} />}
      {tab === 'conversations' && (
        <ConversationsPanel data={data} onChanged={refetch} />
      )}
      {tab === 'listings' && <ListingsPanel data={data} onChanged={refetch} />}
      {tab === 'config' && <ConfigPanel data={data} onChanged={refetch} />}
      {tab === 'assistant' && <AssistantPanel />}
    </div>
  );
}
