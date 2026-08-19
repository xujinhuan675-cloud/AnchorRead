'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';

export function Tabs({ className = '', ...props }) {
  return <TabsPrimitive.Root className={className} {...props} />;
}

export function TabsList({ className = '', ...props }) {
  return (
    <TabsPrimitive.List
      className={`inline-flex h-9 items-center gap-1 rounded-md bg-stone-100 dark:bg-white/10 p-1 ${className}`}
      {...props}
    />
  );
}

export function TabsTrigger({ className = '', ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={`min-w-0 flex-1 rounded px-3 py-1.5 text-xs font-medium text-stone-500 dark:text-stone-400 outline-none transition-colors hover:text-stone-900 dark:hover:text-stone-100 focus-visible:ring-2 focus-visible:ring-stone-400 data-[state=active]:bg-white data-[state=active]:text-stone-900 data-[state=active]:shadow-sm data-[state=active]:dark:bg-stone-800 data-[state=active]:dark:text-stone-100 ${className}`}
      {...props}
    />
  );
}

export function TabsContent({ className = '', ...props }) {
  return (
    <TabsPrimitive.Content
      className={`min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-stone-400 ${className}`}
      {...props}
    />
  );
}
