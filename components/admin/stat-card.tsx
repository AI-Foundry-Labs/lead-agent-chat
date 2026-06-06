import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  accent = false,
  className
}: {
  label: string;
  value: number;
  accent?: boolean;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        'border-border/80 p-4 transition hover:shadow-[var(--shadow-card)]',
        accent && 'border-brand/30 bg-brand/5',
        className
      )}
    >
      <p className={cn('font-display text-3xl font-semibold tabular-nums', accent && 'text-brand')}>
        {value}
      </p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </Card>
  );
}
