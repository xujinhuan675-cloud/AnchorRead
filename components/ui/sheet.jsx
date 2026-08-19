'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  side = 'left',
  className = '',
  children,
  title = '面板',
  ...props
}) {
  const sideClass = side === 'right' ? 'right-0 border-l' : 'left-0 border-r';
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-stone-950/30 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={`fixed inset-y-0 z-50 flex w-[min(88vw,22rem)] flex-col border-stone-200 dark:border-stone-800 bg-white shadow-xl outline-none ${sideClass} ${className}`}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
        <DialogPrimitive.Close
          aria-label="关闭面板"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded text-stone-500 outline-none hover:bg-stone-100 dark:hover:bg-white/10 hover:text-stone-900 dark:hover:text-stone-100 focus-visible:ring-2 focus-visible:ring-stone-400"
        >
          <X size={17} aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
