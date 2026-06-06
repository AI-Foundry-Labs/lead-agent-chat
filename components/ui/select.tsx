import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-9 py-1 text-sm shadow-xs transition-[color,box-shadow]',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'dark:bg-input/30',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
      />
    </div>
  );
});
Select.displayName = 'Select';

export { Select };
