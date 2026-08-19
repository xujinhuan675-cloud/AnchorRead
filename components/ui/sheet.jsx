'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { PanelLeftClose, PanelRightClose } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  side = 'left',
  className = '',
  children,
  title = null,
  hideClose = false,
  ...props
}) {
  const { t } = useLocale();
  const sideClass = side === 'right' ? 'right-0 border-l' : 'left-0 border-r';
  // 关闭按钮与外部收起开关同一图标族（带箭头面板图标），不用叉号：右侧抽屉用 PanelRightClose，左侧用 PanelLeftClose
  const CloseIcon = side === 'right' ? PanelRightClose : PanelLeftClose;
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-stone-950/30 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={`fixed inset-y-0 z-50 flex w-[min(88vw,22rem)] flex-col border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xl outline-none ${sideClass} ${className}`}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title ?? t('common.panel')}</DialogPrimitive.Title>
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label={t('common.closePanel')}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-100 dark:hover:bg-white/10 hover:text-stone-900 dark:hover:text-stone-100 focus-visible:ring-2 focus-visible:ring-stone-400"
          >
            <CloseIcon size={18} aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
