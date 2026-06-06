'use client';

import { useState } from 'react';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageList, ChatShell } from '@/components/chat/chat-shell';
import { AdminSection } from '@/components/admin/admin-section';
import { POTENTIAL_COLOR, adminAction, type AdminData } from '@/components/admin/admin-types';
import { cn } from '@/lib/utils';

type Detail = {
  lead: {
    id: string;
    name: string | null;
    email: string | null;
    status: string;
    potential: string | null;
    qual_values: Record<string, string>;
  };
  mode: string | null;
  messages: { id: string; role: string; content: string }[];
};

export function ConversationsPanel({
  data,
  onChanged
}: {
  data: AdminData | null;
  onChanged: () => void;
}) {
  const { t } = useLang();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState('');

  async function open(leadId: string) {
    const res = await fetch(`/api/admin/conversation?lead_id=${leadId}`);
    if (res.ok) setDetail(await res.json());
  }

  async function act(payload: Record<string, unknown>) {
    await adminAction(payload);
    if (detail) await open(detail.lead.id);
    onChanged();
  }

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(260px,320px)_1fr]">
      <AdminSection title={t.tab_conversations}>
        <div className="max-h-[640px] divide-y divide-border/80 overflow-y-auto rounded-xl border border-border/80 bg-card">
          {data.leads.map((l) => (
            <button
              key={l.id}
              onClick={() => void open(l.id)}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm transition',
                detail?.lead.id === l.id ? 'bg-brand/10' : 'hover:bg-muted/50'
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {l.name ?? l.email ?? '—'}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {l.listing_title ?? '—'} · {l.status}
                </span>
              </span>
              {l.potential && (
                <Badge className={POTENTIAL_COLOR[l.potential] ?? ''}>{l.potential}</Badge>
              )}
            </button>
          ))}
        </div>
      </AdminSection>

      {!detail ? (
        <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-border bg-surface/40 p-8 text-sm text-muted-foreground">
          {t.conv_select}
        </div>
      ) : (
        <ChatShell
          title={detail.lead.name ?? detail.lead.email ?? '—'}
          subtitle={`${detail.lead.status} · ${detail.mode ?? 'agent'}`}
          headerAction={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void act({
                  kind: detail.mode === 'manual' ? 'release' : 'takeover',
                  lead_id: detail.lead.id
                })
              }
            >
              {detail.mode === 'manual' ? t.conv_release : t.conv_takeover}
            </Button>
          }
          footer={
            <ChatComposer
              value={reply}
              onChange={setReply}
              onSend={async () => {
                if (!reply.trim()) return;
                await act({ kind: 'send_reply', lead_id: detail.lead.id, content: reply });
                setReply('');
              }}
              placeholder={t.conv_reply_ph}
              sendLabel={t.conv_send}
            />
          }
        >
          {Object.keys(detail.lead.qual_values).length > 0 && (
            <div className="border-b border-border/80 bg-muted/30 px-4 py-2.5 text-xs">
              <span className="font-medium">{t.conv_qual}: </span>
              {Object.entries(detail.lead.qual_values)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
            </div>
          )}
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
