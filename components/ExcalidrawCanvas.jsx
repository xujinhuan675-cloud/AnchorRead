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

export default function ExcalidrawCanvas({ elements, onElementsChange }) {
  const [convertToExcalidrawElements, setConvertFunction] = useState(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  // 画布随全站明暗切换：theme 传给 Excalidraw，并纳入 remount key 保证背景色同步
  const { theme } = useAppTheme();
  const isDark = theme === 'dark';

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
    if (excalidrawAPI && convertedElements.length > 0) {
      // Small delay to ensure elements are rendered
      setTimeout(() => {
        excalidrawAPI.scrollToContent(convertedElements, {
          fitToContent: true,
          animate: true,
          duration: 300,
        });
      }, 100);
    }
  }, [excalidrawAPI, convertedElements]);

  // Generate unique key when elements change to force remount
  const canvasKey = useMemo(() => {
    const themeSuffix = isDark ? '-dark' : '-light';
    if (convertedElements.length === 0) return `empty${themeSuffix}`;
    // Create a hash from elements to detect changes
    return JSON.stringify(convertedElements.map(el => el.id)).slice(0, 50) + themeSuffix;
  }, [convertedElements, isDark]);

  return (
    <div className="w-full h-full">
      <Excalidraw
        key={canvasKey}
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        theme={isDark ? 'dark' : 'light'}
        initialData={{
          elements: convertedElements,
          appState: {
            viewBackgroundColor: isDark ? '#1c1c1c' : '#ffffff',
            currentItemFontFamily: 1,
          },
          scrollToContent: true,
        }}
        onChange={(nextElements) => onElementsChange?.(nextElements)}
      />
    </div>
  );
}

