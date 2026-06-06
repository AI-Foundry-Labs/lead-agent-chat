import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  className,
  children
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={cn('mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="max-w-2xl space-y-2">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-brand">{eyebrow}</p>
        )}
        <h1 className="text-balance text-3xl font-semibold leading-tight sm:text-4xl">{title}</h1>
        {subtitle && (
          <p className="text-balance text-base leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {children}
    </header>
  );
}
