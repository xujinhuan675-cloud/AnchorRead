'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';

export function ToggleGroup({ className = '', ...props }) {
  return (
    <ToggleGroupPrimitive.Root
      className={`inline-flex h-9 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5 ${className}`}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className = '', ...props }) {
  return (
    <ToggleGroupPrimitive.Item
      className={`h-7 whitespace-nowrap rounded px-3 text-xs font-medium text-gray-500 outline-none transition-colors hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400 data-[state=on]:bg-white data-[state=on]:text-gray-950 data-[state=on]:shadow-sm ${className}`}
      {...props}
    />
  );
}
