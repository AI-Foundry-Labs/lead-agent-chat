'use client';

import { useState } from 'react';
import { useLang } from '@/components/lang-provider';

interface LeadMemoryPanelProps {
  qualValues?: Record<string, string> | null;
  longTermMemory?: string | null;
}

/**
 * Collapsible lead profile + long-term memory.
 * Collapsed by default so it never eats vertical space above the chat thread —
 * the operator expands it on demand.
 */
export function LeadMemoryPanel({ qualValues, longTermMemory }: LeadMemoryPanelProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  const hasQual = qualValues && Object.keys(qualValues).length > 0;
  const memory = longTermMemory?.trim();
  if (!hasQual && !memory) return null;

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
        <div className="max-h-64 space-y-2 overflow-y-auto px-4 pb-3 pt-1">
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
        </div>
      )}
    </div>
  );
}
