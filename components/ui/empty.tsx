import * as React from 'react';
import { cn } from '@/lib/utils';

function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center rounded-lg border border-dashed bg-muted/20 px-6 py-10 gap-2',
        className
      )}
    >
      {icon ? (
        <div className="flex items-center justify-center size-10 rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description ? (
        <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
