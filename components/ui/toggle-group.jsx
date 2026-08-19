'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';

export function ToggleGroup({ className = '', ...props }) {
  return (
    <ToggleGroupPrimitive.Root
      className={`inline-flex h-9 items-center rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-white/5 p-0.5 ${className}`}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className = '', ...props }) {
  return (
    <ToggleGroupPrimitive.Item
      className={`h-7 whitespace-nowrap rounded px-3 text-xs font-medium text-stone-500 outline-none transition-colors hover:text-stone-900 dark:hover:text-stone-100 focus-visible:ring-2 focus-visible:ring-stone-400 data-[state=on]:bg-white data-[state=on]:text-stone-950 data-[state=on]:shadow-sm ${className}`}
      {...props}
    />
  );
}
