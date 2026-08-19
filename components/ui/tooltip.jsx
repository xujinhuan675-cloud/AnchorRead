'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ children, content, side = 'bottom' }) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[70] rounded bg-stone-950 px-2 py-1 text-[11px] text-white shadow-lg dark:bg-stone-100 dark:text-stone-900"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-stone-950 dark:fill-stone-100" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
