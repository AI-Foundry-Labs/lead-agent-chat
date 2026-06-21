'use client';

import { useState } from 'react';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageList, ChatShell } from '@/components/chat/chat-shell';
import { AdminSection } from '@/components/admin/admin-section';
import { LeadMemoryPanel } from '@/components/admin/lead-memory-panel';
import { POTENTIAL_COLOR, adminAction, type AdminData, type AdminThread } from '@/components/admin/admin-types';
import { cn } from '@/lib/utils';

type ThreadDetail = {
  thread: AdminThread;
  lead: {
    id: string;
    name: string | null;
    email: string | null;
    status: string;
    potential: string | null;
    qual_values: Record<string, string>;
    long_term_memory: string | null;
  } | null;
  messages: { id: string; role: string; content: string }[];
};

type ViewScope =
  | { type: 'lead'; leadId: string; label: string }
  | { type: 'anonymous' };

export function ConversationsPanel({
  data,
  onChanged
}: {
  data: AdminData | null;
  onChanged: () => void;
}) {
  const { t } = useLang();
  const [view, setView] = useState<ViewScope | null>(null);
  const [threads, setThreads] = useState<AdminThread[]>([]);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [reply, setReply] = useState('');

  async function loadThreads(scope: ViewScope) {
    setView(scope);
    setDetail(null);
    const qs =
      scope.type === 'anonymous'
        ? 'scope=anonymous'
        : `lead_id=${encodeURIComponent(scope.leadId)}`;
    const res = await fetch(`/api/admin/threads?${qs}`);
    if (!res.ok) return;
    const d = await res.json();
    setThreads(d.threads ?? []);
  }

  async function openThread(conversationId: string) {
    const res = await fetch(`/api/admin/threads?conversation_id=${conversationId}`);
    if (res.ok) setDetail(await res.json());
  }

  async function act(payload: Record<string, unknown>) {
    await adminAction(payload);
    if (detail) await openThread(detail.thread.id);
    onChanged();
    if (view) await loadThreads(view);
  }

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[240px_minmax(220px,280px)_1fr]">
      <AdminSection title={t.tab_agents}>
        <div className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/80 bg-card">
          <button
            type="button"
            onClick={() => void loadThreads({ type: 'anonymous' })}
            className={cn(
              'block w-full px-4 py-3 text-left text-sm transition hover:bg-muted/50',
              view?.type === 'anonymous' && 'bg-brand/10'
            )}
          >
            <span className="font-medium">{t.agent_anonymous_title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {data.anonymous.thread_count} {t.agent_threads_label}
            </span>
          </button>
          {data.leads.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() =>
                void loadThreads({
                  type: 'lead',
                  leadId: l.id,
                  label: l.name ?? l.email ?? '—'
                })
              }
              className={cn(
                'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm transition hover:bg-muted/50',
                view?.type === 'lead' && view.leadId === l.id && 'bg-brand/10'
              )}
            >
              <span className="min-w-0 truncate font-medium">
                {l.name ?? l.email ?? '—'}
              </span>
              {l.potential && (
                <Badge className={POTENTIAL_COLOR[l.potential] ?? ''}>{l.potential}</Badge>
              )}
            </button>
          ))}
        </div>
      </AdminSection>

      <AdminSection title={t.thread_list_title}>
        {!view ? (
          <p className="text-sm text-muted-foreground">{t.conv_select_scope}</p>
        ) : (
          <div className="max-h-[560px] divide-y divide-border/80 overflow-y-auto rounded-xl border border-border/80 bg-card">
            {threads.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => void openThread(th.id)}
                className={cn(
                  'block w-full px-4 py-3 text-left text-sm transition hover:bg-muted/50',
                  detail?.thread.id === th.id && 'bg-brand/10'
                )}
              >
                <span className="font-medium">
                  {th.listing_title ?? t.threads_untitled} · {th.channel}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {th.mode} · {th.thread_summary?.slice(0, 80) ?? '—'}
                </span>
              </button>
            ))}
            {threads.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground">{t.thread_empty}</p>
            )}
          </div>
        )}
      </AdminSection>

      {!detail ? (
        <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-border bg-surface/40 p-8 text-sm text-muted-foreground">
          {t.conv_select_thread}
        </div>
      ) : (
        <ChatShell
          title={`${detail.thread.listing_title ?? t.threads_untitled} · ${detail.thread.channel}`}
          subtitle={`${detail.lead?.status ?? 'anon'} · ${detail.thread.mode}`}
          headerAction={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void act({
                  kind: detail.thread.mode === 'manual' ? 'release' : 'takeover',
                  conversation_id: detail.thread.id
                })
              }
            >
              {detail.thread.mode === 'manual' ? t.conv_release : t.conv_takeover}
            </Button>
          }
          footer={
            <ChatComposer
              value={reply}
              onChange={setReply}
              onSend={async () => {
                if (!reply.trim()) return;
                await act({
                  kind: 'send_reply',
                  conversation_id: detail.thread.id,
                  content: reply
                });
                setReply('');
              }}
              placeholder={t.conv_reply_ph}
              sendLabel={t.conv_send}
            />
          }
        >
          <LeadMemoryPanel
            qualValues={detail.lead?.qual_values}
            longTermMemory={detail.lead?.long_term_memory}
          />
          <ChatMessageList className="max-h-[420px]">
            {detail.messages.map((m) => (
              <ChatBubble key={m.id} role={m.role} content={m.content} />
            ))}
          </ChatMessageList>
        </ChatShell>
      )}
    </div>
  );
}
