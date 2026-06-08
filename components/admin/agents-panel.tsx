'use client';

import { useState } from 'react';
import { useLang } from '@/components/lang-provider';
import { Badge } from '@/components/ui/badge';
import { AdminSection } from '@/components/admin/admin-section';
import { StewardChatPanel, type StewardScope } from '@/components/admin/steward-chat-panel';
import { POTENTIAL_COLOR, type AdminData } from '@/components/admin/admin-types';
import { cn } from '@/lib/utils';

export function AgentsPanel({ data }: { data: AdminData | null }) {
  const { t } = useLang();
  const [scope, setScope] = useState<StewardScope | null>(null);

  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(260px,320px)_1fr]">
        <AdminSection title={t.tab_agents}>
          <div className="max-h-[600px] divide-y divide-border/80 overflow-y-auto rounded-xl border border-border/80 bg-card">
            <button
              type="button"
              onClick={() => setScope({ type: 'anonymous' })}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm transition',
                scope?.type === 'anonymous' ? 'bg-brand/10' : 'hover:bg-muted/50'
              )}
            >
              <span className="min-w-0">
                <span className="block font-medium">{t.agent_anonymous_title}</span>
                <span className="block text-xs text-muted-foreground">
                  {data.anonymous.thread_count} {t.agent_threads_label}
                </span>
              </span>
              <Badge variant="secondary">{t.agent_pool}</Badge>
            </button>

            {data.leads.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() =>
                  setScope({
                    type: 'lead',
                    leadId: l.id,
                    title: l.name ?? l.email ?? l.id.slice(0, 8)
                  })
                }
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm transition',
                  scope?.type === 'lead' && scope.leadId === l.id
                    ? 'bg-brand/10'
                    : 'hover:bg-muted/50'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {l.name ?? l.email ?? '—'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {l.thread_count} {t.agent_threads_label} · {l.status}
                  </span>
                </span>
                {l.potential && (
                  <Badge className={POTENTIAL_COLOR[l.potential] ?? ''}>{l.potential}</Badge>
                )}
              </button>
            ))}

            {data.leads.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground">{t.no_identified_leads}</p>
            )}
          </div>
        </AdminSection>

        <StewardChatPanel scope={scope} />
      </div>
    </div>
  );
}
