'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ChatComposer({
  value,
  onChange,
  onSend,
  placeholder,
  sendLabel,
  disabled,
  className
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  sendLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-2 border-t border-border/80 bg-surface/50 p-3', className)}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={placeholder}
        className="min-h-11 flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-base outline-none transition placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 disabled:opacity-60"
      />
      <Button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        className="min-h-11 rounded-xl px-5 bg-brand text-brand-foreground hover:bg-brand/90"
      >
        {sendLabel}
      </Button>
    </div>
  );
}
