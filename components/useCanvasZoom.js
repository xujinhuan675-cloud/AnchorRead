'use client';

import { useCallback, useEffect, useState } from 'react';

function clamp(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, Number(numericValue.toFixed(2))));
}

/**
 * Shared viewport zoom behavior for SVG-backed canvas views.
 * Excalidraw owns the equivalent behavior internally; this keeps Mermaid
 * views on the same interaction contract without duplicating the controls.
 */
export default function useCanvasZoom({
  initialZoom = 1,
  min = 0.1,
  max = 2.5,
  step = 0.25,
  containerRef = null,
} = {}) {
  const clampZoom = useCallback(
    (value) => clamp(value, min, max, initialZoom),
    [initialZoom, max, min],
  );
  const [zoom, setZoom] = useState(() => clamp(initialZoom, min, max, initialZoom));

  const changeZoom = useCallback((direction) => {
    setZoom((current) => clampZoom(Number(current) + (direction < 0 ? -step : step)));
  }, [clampZoom, step]);

  const resetZoom = useCallback(() => {
    setZoom(clampZoom(initialZoom));
  }, [clampZoom, initialZoom]);

  const handleWheel = useCallback((event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();

    // Match Excalidraw's trackpad-friendly curve: cap a single wheel burst
    // at one button step while preserving smaller deltas for smooth devices.
    const deltaY = Number(event.deltaY);
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    const maxDelta = Math.abs(step) * 100;
    const boundedDelta = Math.sign(deltaY) * Math.min(Math.abs(deltaY), maxDelta);
    setZoom((current) => clampZoom(Number(current) - boundedDelta / 100));
  }, [clampZoom, step]);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return undefined;

    // React may delegate wheel events through a passive listener in some
    // Chrome/runtime combinations. Register at the canvas boundary so the
    // browser cannot apply page-level Ctrl/Cmd zoom to the whole document.
    const options = { capture: true, passive: false };
    container.addEventListener('wheel', handleWheel, options);
    return () => container.removeEventListener('wheel', handleWheel, options);
  }, [containerRef, handleWheel]);

  return {
    zoom,
    changeZoom,
    resetZoom,
    handleWheel,
    zoomOut: () => changeZoom(-1),
    zoomIn: () => changeZoom(1),
  };
}
