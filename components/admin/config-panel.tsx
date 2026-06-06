'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/components/lang-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AdminSection } from '@/components/admin/admin-section';
import { adminAction, type AdminData } from '@/components/admin/admin-types';
import type { Criterion } from '@/lib/types';
import { cn } from '@/lib/utils';

const inputClass =
  'min-h-10 rounded-lg border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 sm:text-sm';

export function ConfigPanel({
  data,
  onChanged
}: {
  data: AdminData | null;
  onChanged: () => void;
}) {
  const { t } = useLang();
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [ruleDesc, setRuleDesc] = useState('');
  const [ruleKw, setRuleKw] = useState('');
  const emptyListing = {
    id: '',
    title: '',
    address: '',
    price: '',
    rooms: '',
    surface_m2: '',
    image_url: ''
  };
  const [nl, setNl] = useState(emptyListing);

  async function addListing() {
    if (!nl.id || !nl.title) return;
    const listing = {
      id: nl.id,
      title: nl.title,
      title_en: nl.title,
      address: nl.address || '—',
      price: Number(nl.price) || 0,
      surface_m2: Number(nl.surface_m2) || 1,
      rooms: Number(nl.rooms) || 1,
      floor: 'RDC',
      floor_en: 'Ground floor',
      description: nl.title,
      description_en: nl.title,
      key_features: [],
      key_features_en: [],
      image_url: nl.image_url || null,
      agent_name: 'Agence Lumière',
      agent_email: 'contact@agence-lumiere.fr',
      agent_calendar_id: 'primary'
    };
    await adminAction({ kind: 'create_listing', listing });
    setNl(emptyListing);
    onChanged();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) setCriteria(data.criteria);
  }, [data]);

  if (!data) return null;

  const setCrit = (i: number, patch: Partial<Criterion>) =>
    setCriteria((c) => c.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-10">
      <AdminSection title={t.cfg_criteria}>
        <div className="space-y-2">
          {criteria.map((c, i) => (
            <div key={i} className="flex flex-wrap gap-2 rounded-xl border border-border/80 bg-card p-3">
              <input
                value={c.key}
                onChange={(e) => setCrit(i, { key: e.target.value })}
                placeholder="key"
                aria-label="Criterion key"
                className={cn(inputClass, 'w-32')}
              />
              <input
                value={c.label}
                onChange={(e) => setCrit(i, { label: e.target.value })}
                placeholder="label"
                aria-label="Criterion label"
                className={cn(inputClass, 'w-48')}
              />
              <input
                value={c.hint ?? ''}
                onChange={(e) => setCrit(i, { hint: e.target.value })}
                placeholder="hint"
                aria-label="Criterion hint"
                className={cn(inputClass, 'min-w-[12rem] flex-1')}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setCriteria((c) => [...c, { key: '', label: '', hint: '' }])
            }
          >
            + {t.cfg_add}
          </Button>
          <Button
            size="sm"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={async () => {
              await adminAction({
                kind: 'update_criteria',
                criteria: criteria.filter((c) => c.key && c.label)
              });
              onChanged();
            }}
          >
            {t.cfg_save}
          </Button>
        </div>
      </AdminSection>

      <AdminSection title={t.cfg_rules}>
        <div className="space-y-2">
          {data.rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-card p-3 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.description}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.trigger_keywords.join(', ')}
                </span>
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  className="cursor-pointer"
                  variant={r.active ? 'default' : 'secondary'}
                  onClick={async () => {
                    await adminAction({ kind: 'toggle_rule', id: r.id, active: !r.active });
                    onChanged();
                  }}
                >
                  {t.cfg_active}: {r.active ? 'on' : 'off'}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await adminAction({ kind: 'delete_rule', id: r.id });
                    onChanged();
                  }}
                >
                  ✕
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={ruleDesc}
            onChange={(e) => setRuleDesc(e.target.value)}
            placeholder="Description (plain language)"
            className={cn(inputClass, 'w-72')}
          />
          <input
            value={ruleKw}
            onChange={(e) => setRuleKw(e.target.value)}
            placeholder="keywords, comma, separated"
            className={cn(inputClass, 'w-60')}
          />
          <Button
            size="sm"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={async () => {
              if (!ruleDesc.trim()) return;
              await adminAction({
                kind: 'create_rule',
                description: ruleDesc,
                trigger_keywords: ruleKw.split(',').map((s) => s.trim()).filter(Boolean)
              });
              setRuleDesc('');
              setRuleKw('');
              onChanged();
            }}
          >
            + {t.cfg_add}
          </Button>
        </div>
      </AdminSection>

      <AdminSection title={t.cfg_listings}>
        <div className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/80 bg-card">
          {data.listings.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="min-w-0 truncate">
                {l.title} <span className="text-muted-foreground">· {l.id}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await adminAction({ kind: 'delete_listing', id: l.id });
                  onChanged();
                }}
              >
                {t.cfg_delete}
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={nl.id} onChange={(e) => setNl({ ...nl, id: e.target.value })} placeholder="id (slug)" className={cn(inputClass, 'w-32')} />
          <input value={nl.title} onChange={(e) => setNl({ ...nl, title: e.target.value })} placeholder="Titre" className={cn(inputClass, 'w-48')} />
          <input value={nl.address} onChange={(e) => setNl({ ...nl, address: e.target.value })} placeholder="Adresse" className={cn(inputClass, 'w-48')} />
          <input value={nl.price} onChange={(e) => setNl({ ...nl, price: e.target.value })} placeholder="Prix €" className={cn(inputClass, 'w-24')} />
          <input value={nl.rooms} onChange={(e) => setNl({ ...nl, rooms: e.target.value })} placeholder="Pièces" className={cn(inputClass, 'w-20')} />
          <input value={nl.surface_m2} onChange={(e) => setNl({ ...nl, surface_m2: e.target.value })} placeholder="m²" className={cn(inputClass, 'w-20')} />
          <input value={nl.image_url} onChange={(e) => setNl({ ...nl, image_url: e.target.value })} placeholder="image URL" className={cn(inputClass, 'w-48')} />
          <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => void addListing()}>+ {t.cfg_add}</Button>
        </div>
      </AdminSection>
    </div>
  );
}
