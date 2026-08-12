'use client';

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

export function ScrollArea({ className = '', children, ...props }) {
  return (
    <ScrollAreaPrimitive.Root className={`relative overflow-hidden ${className}`} {...props}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2.5 touch-none select-none p-0.5"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-gray-300" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
