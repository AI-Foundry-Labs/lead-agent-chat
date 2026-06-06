import { cn } from '@/lib/utils';

export function ChatBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user';
  const isSystem = role === 'system';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
          isUser && 'rounded-br-md bg-primary text-primary-foreground shadow-sm',
          !isUser &&
            !isSystem &&
            'rounded-bl-md border border-border/60 bg-card text-foreground shadow-[var(--shadow-card)]',
          isSystem && 'bg-muted/80 text-xs text-muted-foreground'
        )}
      >
        {content}
      </div>
    </div>
  );
}
