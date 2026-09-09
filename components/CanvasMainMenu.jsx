'use client';

import { Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import CanvasToolbar from './CanvasToolbar';
import CanvasToolbarButton from './CanvasToolbarButton';

/** Shared canvas menu shell for renderers without Excalidraw's internal UI context. */
export default function CanvasMainMenu({
  items = [],
  openLabel = 'Open canvas menu',
  closeLabel = 'Close canvas menu',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  if (!items.length) return null;

  const label = open ? closeLabel : openLabel;
  return (
    <div ref={rootRef} className={`absolute left-4 top-4 z-30 ${className}`.trim()}>
      <CanvasToolbar floating className="!p-0" aria-label={openLabel}>
        <CanvasToolbarButton
          onClick={() => setOpen((current) => !current)}
          ariaLabel={label}
          title={label}
          active={open}
          className="!rounded-lg"
        >
          <Menu size={16} aria-hidden="true" />
        </CanvasToolbarButton>
      </CanvasToolbar>
      {open && (
        <div
          role="menu"
          aria-label={openLabel}
          className="absolute left-0 top-12 z-50 min-w-[14.125rem] rounded-lg border border-stone-200 bg-white p-2 shadow-xl dark:border-stone-700 dark:bg-stone-900"
        >
          {items.map((item) => (
            <button
              key={item.id || item.label}
              type="button"
              role="menuitemcheckbox"
              aria-checked={item.selected ? 'true' : 'false'}
              onClick={() => {
                item.onSelect?.();
                setOpen(false);
              }}
              disabled={item.disabled}
              className={`m-px flex h-8 min-[1921px]:h-9 w-[calc(100%-2px)] items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm text-[#1b1b1f] outline-none transition-colors hover:bg-[#f1f0ff] focus-visible:ring-2 focus-visible:ring-stone-400 active:bg-[#f1f0ff] disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#e3e3e8] dark:hover:bg-[#363541] dark:active:bg-[#363541] ${item.selected ? 'bg-[#e3e2fe] text-[#030064] dark:bg-[#4f4d6f] dark:text-[#e0dfff]' : ''}`.trim()}
            >
              <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
