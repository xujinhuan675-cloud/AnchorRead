'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo, useRef } from 'react';
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

function sceneElementsChanged(currentElements, nextElements) {
  if (!Array.isArray(currentElements) || currentElements.length !== nextElements.length) return true;
  return nextElements.some((nextElement, index) => {
    const currentElement = currentElements[index];
    return currentElement?.id !== nextElement?.id
      || currentElement?.version !== nextElement?.version
      || currentElement?.isDeleted !== nextElement?.isDeleted
      || currentElement?.strokeColor !== nextElement?.strokeColor
      || currentElement?.strokeWidth !== nextElement?.strokeWidth;
  });
}

export default function ExcalidrawCanvas({
  elements,
  onElementsChange,
  appState,
  files,
  onSceneChange,
  presentationStep = null,
  presentationActive = false,
}) {
  const [convertToExcalidrawElements, setConvertFunction] = useState(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const ignoreSceneChangesRef = useRef(false);
  const restoreFullSceneRef = useRef(false);
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
    ...(presentationActive ? { viewModeEnabled: true } : {}),
  }), [appState, isDark, presentationActive]);

  // Load convert function on mount
  useEffect(() => {
    getConvertFunction().then(fn => {
      setConvertFunction(() => fn);
    });
  }, []);

  // Convert elements to Excalidraw format
  const presentationElements = useMemo(() => {
    if (!presentationActive || !presentationStep) return elements;
    const visible = presentationStep.visibleElementIds?.length ? new Set(presentationStep.visibleElementIds) : null;
    const highlighted = new Set(presentationStep.highlightElementIds || []);
    return (elements || [])
      .filter((element) => !visible || visible.has(element.id))
      .map((element) => highlighted.has(element.id) ? {
        ...element,
        strokeColor: '#e11d48',
        strokeWidth: Math.max(2, Number(element.strokeWidth) || 1),
      } : element);
  }, [elements, presentationActive, presentationStep]);

  const convertedElements = useMemo(() => {
    if (!presentationElements || presentationElements.length === 0) {
      return [];
    }

    try {
      if (presentationElements.every((element) => Number.isFinite(element?.version))) {
        return presentationElements;
      }
      if (!convertToExcalidrawElements) return [];
      return convertToExcalidrawElements(presentationElements);
    } catch (error) {
      console.error('Failed to convert elements:', error);
      return [];
    }
  }, [presentationElements, convertToExcalidrawElements]);

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

  useEffect(() => {
    if (!presentationActive) return undefined;
    restoreFullSceneRef.current = true;
    if (!excalidrawAPI || !presentationStep) return undefined;
    const timer = setTimeout(() => {
      ignoreSceneChangesRef.current = true;
      if (typeof excalidrawAPI.updateScene === 'function') {
        excalidrawAPI.updateScene({ elements: convertedElements, appState: { viewModeEnabled: true } });
      }
      if (presentationStep.camera && typeof excalidrawAPI.updateScene === 'function') {
        excalidrawAPI.updateScene({ appState: { ...presentationStep.camera, viewModeEnabled: true } });
      } else if (convertedElements.length > 0 && typeof excalidrawAPI.scrollToContent === 'function') {
        const focusIds = new Set(presentationStep.focusElementIds || []);
        const focusElements = focusIds.size > 0
          ? convertedElements.filter((element) => focusIds.has(element.id))
          : convertedElements;
        excalidrawAPI.scrollToContent(focusElements.length > 0 ? focusElements : convertedElements, {
          fitToContent: true,
          animate: true,
          duration: presentationStep.transitionMs,
        });
      }
      setTimeout(() => { ignoreSceneChangesRef.current = false; }, 0);
    }, 30);
    return () => clearTimeout(timer);
  }, [excalidrawAPI, convertedElements, presentationActive, presentationStep]);

  useEffect(() => {
    if (presentationActive || !restoreFullSceneRef.current || !excalidrawAPI || typeof excalidrawAPI.updateScene !== 'function') return;
    restoreFullSceneRef.current = false;
    const currentElements = typeof excalidrawAPI.getSceneElements === 'function'
      ? excalidrawAPI.getSceneElements()
      : [];
    const currentAppState = typeof excalidrawAPI.getAppState === 'function'
      ? excalidrawAPI.getAppState()
      : null;
    const restoredAppState = {
      ...initialAppState,
      viewModeEnabled: Boolean(appState?.viewModeEnabled),
    };
    const elementsChanged = sceneElementsChanged(currentElements, convertedElements);
    const appStateChanged = viewportValueChanged(currentAppState, restoredAppState)
      || currentAppState?.viewModeEnabled !== restoredAppState.viewModeEnabled;
    if (!elementsChanged && !appStateChanged) return;
    ignoreSceneChangesRef.current = true;
    excalidrawAPI.updateScene({
      ...(elementsChanged ? { elements: convertedElements } : {}),
      ...(appStateChanged ? { appState: restoredAppState } : {}),
    });
    setTimeout(() => { ignoreSceneChangesRef.current = false; }, 250);
  }, [appState?.viewModeEnabled, convertedElements, excalidrawAPI, initialAppState, presentationActive]);

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

  // Keep the Excalidraw instance stable while presentation steps reveal subsets.
  const canvasKey = useMemo(() => {
    const themeSuffix = isDark ? '-dark' : '-light';
    const needsConversion = elements?.some((element) => !Number.isFinite(element?.version));
    const conversionSuffix = needsConversion
      ? (convertToExcalidrawElements ? '-ready' : '-loading')
      : '-native';
    if (!elements || elements.length === 0) return `empty${themeSuffix}${conversionSuffix}`;
    // Create a hash from elements to detect changes
    return JSON.stringify(elements.map(el => el.id)).slice(0, 50) + themeSuffix + conversionSuffix;
  }, [convertToExcalidrawElements, elements, isDark]);

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
          // The dynamic converter mounts Excalidraw once before a legacy scene
          // is ready. Ignore that transient empty callback instead of erasing
          // the persisted scene during initialization.
          if (presentationActive || ignoreSceneChangesRef.current
            || (!convertToExcalidrawElements && elements?.length > 0)) return;
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

