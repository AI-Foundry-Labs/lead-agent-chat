import * as React from 'react';
import { cn } from '@/lib/utils';

function Section({
  title,
  description,
  action,
  children,
  className
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-4', className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export { Section };
