'use client';

import { useLang } from '@/components/lang-provider';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatSlot } from '@/lib/format';
import { POTENTIAL_COLOR, type AdminData, type AdminLead } from '@/components/admin/admin-types';

export function DashboardPanel({ data }: { data: AdminData | null }) {
  const { t, lang } = useLang();
  if (!data) return <p className="text-sm text-muted-foreground">…</p>;

  const leads = data.leads;
  const by = (s: string) => leads.filter((l) => l.status === s);
  const stats = [
    { label: t.dash_total, value: leads.length },
    { label: t.dash_active, value: by('active').length },
    { label: t.dash_qualified, value: by('qualified').length },
    { label: t.dash_booked, value: by('booked').length },
    { label: t.dash_handoff, value: by('handoff').length }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-2xl font-semibold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>

      <LeadGroup title={t.dash_handoff} leads={by('handoff')} lang={lang} />
      <LeadGroup title={t.dash_booked} leads={by('booked')} lang={lang} />
      <LeadGroup title={t.dash_qualified} leads={by('qualified')} lang={lang} />
      <LeadGroup title={t.dash_active} leads={by('active')} lang={lang} />
    </div>
  );
}

function LeadGroup({
  title,
  leads,
  lang
}: {
  title: string;
  leads: AdminLead[];
  lang: 'fr' | 'en';
}) {
  if (leads.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">
        {title} ({leads.length})
      </h3>
      <div className="divide-y rounded-lg border">
        {leads.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{l.name ?? l.email ?? '—'}</p>
              <p className="truncate text-xs text-muted-foreground">
                {l.listing_title ?? '—'}
                {l.booked_slot ? ` · ${formatSlot(l.booked_slot, lang)}` : ''}
                {l.reason ? ` · ${l.reason}` : ''}
              </p>
            </div>
            {l.potential && (
              <Badge className={POTENTIAL_COLOR[l.potential] ?? ''}>{l.potential}</Badge>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
