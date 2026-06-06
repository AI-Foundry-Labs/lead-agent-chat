'use client';

import { useState } from 'react';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { POTENTIAL_COLOR, adminAction, type AdminData } from '@/components/admin/admin-types';

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

  if (!data) return <p className="text-sm text-muted-foreground">…</p>;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
      <div className="divide-y rounded-lg border">
        {data.leads.map((l) => (
          <button
            key={l.id}
            onClick={() => void open(l.id)}
            className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm hover:bg-muted"
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

      {!detail ? (
        <Card className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          {t.conv_select}
        </Card>
      ) : (
        <Card className="flex flex-col p-0">
          <div className="flex items-center justify-between border-b p-3">
            <div>
              <p className="text-sm font-medium">
                {detail.lead.name ?? detail.lead.email ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                {detail.lead.status} · {detail.mode ?? 'agent'}
              </p>
            </div>
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
          </div>

          {Object.keys(detail.lead.qual_values).length > 0 && (
            <div className="border-b bg-muted/40 px-3 py-2 text-xs">
              <span className="font-medium">{t.conv_qual}: </span>
              {Object.entries(detail.lead.qual_values)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
            </div>
          )}

          <div className="max-h-[420px] flex-1 space-y-2 overflow-y-auto p-3">
            {detail.messages.map((m) => (
              <div
                key={m.id}
                className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[80%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-3 py-2 text-sm text-white'
                      : 'max-w-[80%] whitespace-pre-wrap rounded-2xl bg-muted px-3 py-2 text-sm'
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 border-t p-3">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={t.conv_reply_ph}
              className="flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <Button
              onClick={async () => {
                if (!reply.trim()) return;
                await act({ kind: 'send_reply', lead_id: detail.lead.id, content: reply });
                setReply('');
              }}
            >
              {t.conv_send}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
