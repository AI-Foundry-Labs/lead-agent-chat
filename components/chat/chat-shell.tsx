'use client';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function ChatShell({
  title,
  subtitle,
  headerAction,
  children,
  footer,
  className,
  heightClass = 'h-[min(640px,calc(100dvh-12rem))]'
}: {
  title: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
  className?: string;
  heightClass?: string;
}) {
  return (
    <Card
      className={cn(
        'flex flex-col overflow-hidden border-border/80 p-0 shadow-[var(--shadow-elevated)]',
        heightClass,
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/80 bg-surface/60 px-4 py-3.5">
        <div>
          <p className="font-display text-sm font-semibold">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      {footer}
    </Card>
  );
}

export function ChatMessageList({
  scrollRef,
  children,
  className
}: {
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      ref={scrollRef}
      className={cn('flex-1 space-y-3 overflow-y-auto px-4 py-4 scroll-smooth', className)}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {children}
    </div>
  );
}

export function ChatTypingIndicator() {
  return (
    <div className="flex justify-start" aria-label="Assistant is typing">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-border/60 bg-card px-4 py-3 shadow-[var(--shadow-card)]">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
      </div>
    </div>
  );
}
