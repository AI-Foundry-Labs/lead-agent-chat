'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
  const [persona, setPersona] = useState(data?.adminPersona ?? '');
  const [personaSaving, setPersonaSaving] = useState(false);
  const personaRef = useRef(data?.adminPersona ?? '');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) {
      setCriteria(data.criteria);
      setPersona(data.adminPersona ?? '');
      personaRef.current = data.adminPersona ?? '';
    }
  }, [data]);

  async function savePersona() {
    const value = persona.trim() || null;
    if (value === (personaRef.current.trim() || null)) return; // no change
    setPersonaSaving(true);
    await fetch('/api/admin/persona', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: value }),
    }).catch(() => null);
    personaRef.current = persona;
    setPersonaSaving(false);
  }

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
                size="icon-sm"
                variant="ghost"
                aria-label={t.cfg_delete}
                onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" aria-hidden />
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
            <Plus className="size-4" aria-hidden />
            {t.cfg_add}
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
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t.cfg_delete}
                  onClick={async () => {
                    await adminAction({ kind: 'delete_rule', id: r.id });
                    onChanged();
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
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
            <Plus className="size-4" aria-hidden />
            {t.cfg_add}
          </Button>
        </div>
      </AdminSection>

      <AdminSection title={t.cfg_persona_title}>
        <p className="mb-2 text-sm text-muted-foreground">
          {t.cfg_persona_desc}
        </p>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          onBlur={savePersona}
          rows={5}
          placeholder={t.cfg_persona_ph}
          className={cn(inputClass, 'min-h-[120px] w-full resize-y text-sm')}
        />
        {personaSaving && (
          <p className="mt-1 text-xs text-muted-foreground">{t.cfg_persona_saving}</p>
        )}
      </AdminSection>

    </div>
  );
}
