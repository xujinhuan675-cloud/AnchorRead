'use client';

import { Minus, Plus } from 'lucide-react';
import CanvasToolbarButton from './CanvasToolbarButton';

/** Shared Excalidraw-style viewport controls for non-Excalidraw renderers. */
export default function CanvasZoomControls({
  zoom,
  min = 0.5,
  max = 2.5,
  initial = 1,
  ariaLabel,
  zoomOutLabel,
  zoomResetLabel,
  zoomInLabel,
  onZoomOut,
  onReset,
  onZoomIn,
  className = '',
}) {
  return (
    <div
      className={`pointer-events-auto flex items-center gap-0 rounded-lg bg-[#ececf4] p-0.5 shadow-[0_0_0_1px_#fff] backdrop-blur dark:bg-[hsl(240,8%,15%)] dark:shadow-[0_0_0_1px_hsl(0,0%,7%)] ${className}`.trim()}
      aria-label={ariaLabel}
    >
      <CanvasToolbarButton
        ariaLabel={zoomOutLabel}
        disabled={zoom <= min}
        onClick={onZoomOut}
        className="!rounded-l-lg !rounded-r-none !bg-transparent hover:!bg-[#f1f0ff] dark:hover:!bg-[hsl(245,10%,21%)]"
      >
        <Minus aria-hidden="true" className="h-4 w-4" />
      </CanvasToolbarButton>
      <CanvasToolbarButton
        ariaLabel={zoomResetLabel}
        disabled={zoom === initial}
        onClick={onReset}
        className="!w-[3.75rem] !rounded-none !bg-transparent px-2.5 text-xs tabular-nums hover:!bg-[#f1f0ff] dark:hover:!bg-[hsl(245,10%,21%)]"
      >
        {Math.round(zoom * 100)}%
      </CanvasToolbarButton>
      <CanvasToolbarButton
        ariaLabel={zoomInLabel}
        disabled={zoom >= max}
        onClick={onZoomIn}
        className="!rounded-l-none !rounded-r-lg !bg-transparent hover:!bg-[#f1f0ff] dark:hover:!bg-[hsl(245,10%,21%)]"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </CanvasToolbarButton>
    </div>
  );
}
