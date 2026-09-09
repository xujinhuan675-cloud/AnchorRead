'use client';

import { Minus, Plus } from 'lucide-react';
import CanvasToolbar from './CanvasToolbar';
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
    <CanvasToolbar
      floating
      className={`pointer-events-auto !gap-0 !p-0 rounded-lg ${className}`.trim()}
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
    </CanvasToolbar>
  );
}
