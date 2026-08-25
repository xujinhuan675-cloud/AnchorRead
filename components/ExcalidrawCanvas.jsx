'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo } from 'react';
import '@excalidraw/excalidraw/index.css';
import { useAppTheme } from '@/lib/theme';

// Dynamically import Excalidraw with no SSR
const Excalidraw = dynamic(
  async () => (await import('@excalidraw/excalidraw')).Excalidraw,
  { ssr: false }
);

// Dynamically import convertToExcalidrawElements
const getConvertFunction = async () => {
  const excalidrawModule = await import('@excalidraw/excalidraw');
  return excalidrawModule.convertToExcalidrawElements;
};

function zoomValue(value) {
  return value && typeof value === 'object' ? value.value : value;
}

function viewportValueChanged(currentAppState, nextAppState) {
  const numericKeys = ['scrollX', 'scrollY'];
  const positionChanged = numericKeys.some((key) => {
    const nextValue = nextAppState?.[key];
    // Missing viewport fields are valid for legacy scenes. Do not turn
    // undefined into NaN: NaN !== NaN would create an update loop.
    return nextValue !== undefined
      && nextValue !== null
      && currentAppState?.[key] !== nextValue;
  });
  const nextZoom = zoomValue(nextAppState?.zoom);
  const currentZoom = zoomValue(currentAppState?.zoom);
  const zoomChanged = nextZoom !== undefined
    && nextZoom !== null
    && currentZoom !== nextZoom;
  return positionChanged || zoomChanged;
}

export default function ExcalidrawCanvas({
  elements,
  onElementsChange,
  appState,
  files,
  onSceneChange,
}) {
  const [convertToExcalidrawElements, setConvertFunction] = useState(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  // 画布随全站明暗切换：theme 传给 Excalidraw，并纳入 remount key 保证背景色同步
  const { theme } = useAppTheme();
  const isDark = theme === 'dark';
  const hasPersistedAppState = Boolean(appState && [
    'scrollX',
    'scrollY',
    'zoom',
    'viewModeEnabled',
  ].some((key) => Object.hasOwn(appState, key)));

  // Keep the existing theme defaults, while allowing a persisted scene to
  // restore any additional Excalidraw app state (zoom, viewport, selections,
  // and so on). Explicit values from the caller take precedence.
  const initialAppState = useMemo(() => ({
    viewBackgroundColor: isDark ? '#1c1c1c' : '#ffffff',
    currentItemFontFamily: 1,
    ...appState,
  }), [appState, isDark]);

  // Load convert function on mount
  useEffect(() => {
    getConvertFunction().then(fn => {
      setConvertFunction(() => fn);
    });
  }, []);

  // Convert elements to Excalidraw format
  const convertedElements = useMemo(() => {
    if (!elements || elements.length === 0 || !convertToExcalidrawElements) {
      return [];
    }

    try {
      if (elements.every((element) => Number.isFinite(element?.version))) {
        return elements;
      }
      return convertToExcalidrawElements(elements);
    } catch (error) {
      console.error('Failed to convert elements:', error);
      return [];
    }
  }, [elements, convertToExcalidrawElements]);

  // Auto zoom to fit content when API is ready and elements change
  useEffect(() => {
    if (excalidrawAPI && convertedElements.length > 0 && !hasPersistedAppState) {
      // Small delay to ensure elements are rendered
      setTimeout(() => {
        excalidrawAPI.scrollToContent(convertedElements, {
          fitToContent: true,
          animate: true,
          duration: 300,
        });
      }, 100);
    }
  }, [excalidrawAPI, convertedElements, hasPersistedAppState]);

  // Apply a persisted viewport to an already-mounted Excalidraw instance.
  // Remounting on every appState change would interrupt normal pan/zoom input,
  // so only update the camera when the incoming values differ from the API.
  useEffect(() => {
    if (!excalidrawAPI || !hasPersistedAppState || typeof excalidrawAPI.updateScene !== 'function') return;
    const current = typeof excalidrawAPI.getAppState === 'function'
      ? excalidrawAPI.getAppState()
      : null;
    if (viewportValueChanged(current, initialAppState)) {
      excalidrawAPI.updateScene({ appState: initialAppState });
    }
  }, [excalidrawAPI, hasPersistedAppState, initialAppState]);

  // Generate unique key when elements change to force remount
  const canvasKey = useMemo(() => {
    const themeSuffix = isDark ? '-dark' : '-light';
    if (convertedElements.length === 0) return `empty${themeSuffix}`;
    // Create a hash from elements to detect changes
    return JSON.stringify(convertedElements.map(el => el.id)).slice(0, 50) + themeSuffix;
  }, [convertedElements, isDark]);

  return (
    <div className="anchor-read-excalidraw relative h-full w-full">
      <Excalidraw
        key={canvasKey}
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        theme={isDark ? 'dark' : 'light'}
        initialData={{
          elements: convertedElements,
          appState: initialAppState,
          ...(files === undefined ? {} : { files }),
          scrollToContent: !hasPersistedAppState,
        }}
        onChange={(nextElements, nextAppState, nextFiles) => {
          // Preserve the original callback contract for existing callers.
          onElementsChange?.(nextElements);
          // Expose one canonical scene object to persistence consumers while
          // keeping the legacy element-only callback above unchanged.
          onSceneChange?.({
            elements: nextElements,
            appState: nextAppState,
            files: nextFiles,
          });
        }}
      />
    </div>
  );
}

