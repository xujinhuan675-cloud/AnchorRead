'use client';

import { useAppTheme } from '@/lib/theme';

/**
 * 画布工具栏通用按钮
 *
 * 用于 MermaidCanvas 和 ExcalidrawCanvas 的操作按钮
 * 统一淡紫色风格，与 Excalidraw 官方按钮保持一致
 */
export default function CanvasToolbarButton({
  onClick,
  children,
  ariaLabel,
  label,
  title,
  active = false,
  disabled = false,
  className = '',
}) {
  const { theme } = useAppTheme();
  const resolvedLabel = ariaLabel ?? label;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={resolvedLabel}
      title={title || resolvedLabel}
      disabled={disabled}
      aria-pressed={active}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded outline-none transition-colors focus-visible:ring-2 focus-visible:ring-stone-400 ${
        theme === 'dark' ? 'text-stone-100' : 'text-[#1b1b1f]'
      } ${
        disabled
          ? 'opacity-35 cursor-not-allowed bg-transparent'
          : 'hover:bg-[#f1f0ff] hover:text-stone-900 dark:hover:bg-[hsl(245,10%,21%)] dark:hover:text-stone-100'
      } ${className}`.trim()}
    >
      {children}
    </button>
  );
}
