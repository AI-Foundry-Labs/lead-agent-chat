'use client';

import { useLang } from '@/components/lang-provider';
import { StatCard } from '@/components/admin/stat-card';
import { AdminSection } from '@/components/admin/admin-section';
import { Badge } from '@/components/ui/badge';
import { formatSlot } from '@/lib/format';
import { POTENTIAL_COLOR, type AdminData, type AdminLead } from '@/components/admin/admin-types';

export function DashboardPanel({ data }: { data: AdminData | null }) {
  const { t, lang } = useLang();
  if (!data) return null;

  const leads = data.leads;
  const by = (s: string) => leads.filter((l) => l.status === s);
  const stats = [
    { label: t.dash_total, value: leads.length, accent: false },
    { label: t.dash_active, value: by('active').length, accent: false },
    { label: t.dash_qualified, value: by('qualified').length, accent: false },
    { label: t.dash_booked, value: by('booked').length, accent: true },
    { label: t.dash_handoff, value: by('handoff').length, accent: true }
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} accent={s.accent} />
        ))}
      </div>

      <LeadGroup title={t.dash_handoff} leads={by('handoff')} lang={lang} urgent />
      <LeadGroup title={t.dash_booked} leads={by('booked')} lang={lang} />
      <LeadGroup title={t.dash_qualified} leads={by('qualified')} lang={lang} />
      <LeadGroup title={t.dash_active} leads={by('active')} lang={lang} />

      {data.anonymous.thread_count > 0 && (
        <AdminSection title={`${t.agent_anonymous_title} (${data.anonymous.thread_count})`}>
          <p className="text-sm text-muted-foreground">
            {data.anonymous.thread_count} {t.agent_threads_label}
            {data.anonymous.handoff_count > 0
              ? ` · ${data.anonymous.handoff_count} handoff`
              : ''}
          </p>
        </AdminSection>
      )}
    </div>
  );
}

function LeadGroup({
  title,
  leads,
  lang,
  urgent = false
}: {
  title: string;
  leads: AdminLead[];
  lang: 'fr' | 'en';
  urgent?: boolean;
}) {
  if (leads.length === 0) return null;
  return (
    <AdminSection title={`${title} (${leads.length})`}>
      <div className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/80 bg-card">
        {leads.map((l) => (
          <div
            key={l.id}
            className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition hover:bg-muted/40"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{l.name ?? l.email ?? '—'}</p>
              <p className="truncate text-xs text-muted-foreground">
                {l.listing_title ?? '—'}
                {l.booked_slot ? ` · ${formatSlot(l.booked_slot, lang)}` : ''}
                {l.reason ? ` · ${l.reason}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {urgent && (
                <Badge variant="warning" className="hidden sm:inline-flex">
                  handoff
                </Badge>
              )}
              {l.potential && (
                <Badge className={POTENTIAL_COLOR[l.potential] ?? ''}>{l.potential}</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </AdminSection>
  );
}
