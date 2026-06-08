'use client';

import { cn } from '@/lib/utils';

type TabKey = 'agents' | 'dashboard' | 'conversations' | 'listings' | 'config' | 'assistant';

export function AdminTabNav({
  tabs,
  active,
  onChange
}: {
  tabs: { key: TabKey; label: string }[];
  active: TabKey;
  onChange: (key: TabKey) => void;
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-1 rounded-xl border border-border/80 bg-surface/60 p-1"
      role="tablist"
      aria-label="Admin sections"
    >
      {tabs.map((tb) => (
        <button
          key={tb.key}
          role="tab"
          aria-selected={active === tb.key}
          onClick={() => onChange(tb.key)}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition',
            active === tb.key
              ? 'bg-brand text-brand-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {tb.label}
        </button>
      ))}
    </div>
  );
}
