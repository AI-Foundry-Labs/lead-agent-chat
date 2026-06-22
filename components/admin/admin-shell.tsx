'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/components/lang-provider';
import { LangToggle } from '@/components/lang-toggle';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
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
type CopyState = 'idle' | 'copied';

export function AdminShell() {
  const { t } = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');

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

  // Group linking — admin pastes /link <token> INSIDE the agency supergroup to
  // bind the group and auto-create the 🛠 Master topic. No deep link (the command
  // must be sent in the group, not a DM).
  async function linkTelegram() {
    if (linkInfo) { setLinkInfo(null); return; }
    const res = await fetch('/api/admin/link-telegram', { method: 'POST' });
    const d = await res.json();
    setLinkInfo({ deepLink: null, command: d.command ?? '' });
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
          <LangToggle />
          <Button variant="outline" size="sm" onClick={() => void linkTelegram()}>
            {t.link_telegram}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            {t.logout}
          </Button>
        </div>
      </div>

      {linkInfo && (
        <div className="flex justify-end">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface/60 p-4 shadow-sm">
            <p className="mb-3 text-xs font-medium text-muted-foreground">
              {t.link_info}
            </p>
            <div className="flex flex-col gap-2">
              {linkInfo.deepLink && (
                <a
                  href={linkInfo.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-lg bg-[#2AABEE] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1d96d3]"
                >
                  <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                  {t.link_open_telegram}
                </a>
              )}
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <code className="flex-1 truncate text-xs text-foreground">{linkInfo.command}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(linkInfo.command).then(() => {
                      setCopyState('copied');
                      setTimeout(() => setCopyState('idle'), 2000);
                    });
                  }}
                  className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title={t.link_copy_command}
                >
                  {copyState === 'copied'
                    ? <Check className="size-3.5 text-green-600" />
                    : <Copy className="size-3.5" />}
                </button>
              </div>
              {copyState === 'copied' && (
                <p className="text-center text-xs text-green-600">{t.link_copied}</p>
              )}
            </div>
          </div>
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
