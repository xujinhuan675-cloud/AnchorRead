'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';

export function Tabs({ className = '', ...props }) {
  return <TabsPrimitive.Root className={className} {...props} />;
}

export function TabsList({ className = '', ...props }) {
  return (
    <TabsPrimitive.List
      className={`inline-flex h-9 items-center gap-1 rounded-md bg-gray-100 p-1 ${className}`}
      {...props}
    />
  );
}

export function TabsTrigger({ className = '', ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={`min-w-0 flex-1 rounded px-3 py-1.5 text-xs font-medium text-gray-500 outline-none transition-colors hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm ${className}`}
      {...props}
    />
  );
}

export function TabsContent({ className = '', ...props }) {
  return (
    <TabsPrimitive.Content
      className={`min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${className}`}
      {...props}
    />
  );
}
