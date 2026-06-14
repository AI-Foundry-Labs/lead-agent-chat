'use client';

import { useState } from 'react';
import { useLang } from '@/components/lang-provider';

interface LeadMemoryPanelProps {
  qualValues?: Record<string, string> | null;
  longTermMemory?: string | null;
  persona?: string | null;
  leadId?: string;
}

/**
 * Collapsible lead profile + long-term memory + editable persona.
 */
export function LeadMemoryPanel({ qualValues, longTermMemory, persona, leadId }: LeadMemoryPanelProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [personaText, setPersonaText] = useState(persona ?? '');
  const [saving, setSaving] = useState(false);

  const hasQual = qualValues && Object.keys(qualValues).length > 0;
  const memory = longTermMemory?.trim();
  const hasContent = hasQual || memory || leadId;
  if (!hasContent) return null;

  async function savePersona() {
    if (!leadId) return;
    setSaving(true);
    await fetch(`/api/admin/lead/${leadId}/persona`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: personaText })
    }).catch(() => null);
    setSaving(false);
  }

  return (
    <div className="border-b border-border/80 bg-muted/20 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2 font-medium transition hover:bg-muted/40"
      >
        <span>{t.conv_lead_context}</span>
        <span className="text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="max-h-80 space-y-3 overflow-y-auto px-4 pb-3 pt-1">
          {hasQual && (
            <div>
              <span className="font-medium">{t.conv_qual}: </span>
              {Object.entries(qualValues!)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
            </div>
          )}
          {memory && (
            <div className="whitespace-pre-wrap">
              <span className="font-medium">{t.conv_memory}: </span>
              {memory}
            </div>
          )}
          {leadId && (
            <div className="space-y-1">
              <span className="font-medium">{t.conv_persona}</span>
              <textarea
                value={personaText}
                onChange={(e) => setPersonaText(e.target.value)}
                onBlur={savePersona}
                rows={4}
                placeholder="Rédigez un profil synthétique du prospect…"
                className="w-full resize-none rounded-lg border border-input bg-background p-2 text-xs outline-none transition focus-visible:border-brand focus-visible:ring-1 focus-visible:ring-brand/20"
              />
              {saving && <span className="text-muted-foreground">Enregistrement…</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
