'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LoaderCircle, PenTool } from 'lucide-react';
import { parseExcalidrawElements } from '@/lib/diagram-generation';
import {
  createStrictMermaidConfig,
  sanitizeMermaidSvg,
  validateMermaidSource,
} from '@/lib/mermaid-render';
import { useAppTheme } from '@/lib/theme';

function prepareSvg(svg, title) {
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.display = 'block';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.maxWidth = '100%';
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  return svg;
}

export default function DiagramThumbnail({ drawing, title }) {
  const hostRef = useRef(null);
  const reactId = useId();
  const { theme } = useAppTheme();
  const [status, setStatus] = useState('loading');
  const engine = drawing?.renderer || drawing?.engine || 'mermaid';
  const source = drawing?.source || '';
  const renderId = useMemo(
    () => `anchor-read-thumbnail-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let cancelled = false;
    host.replaceChildren();
    if (!String(source).trim()) {
      setStatus('empty');
      return undefined;
    }
    setStatus('loading');

    async function renderThumbnail() {
      try {
        let svg;
        if (engine === 'excalidraw') {
          const elements = parseExcalidrawElements(source);
          const excalidraw = await import('@excalidraw/excalidraw');
          const normalizedElements = elements.every((element) => Number.isFinite(element?.version))
            ? elements
            : excalidraw.convertToExcalidrawElements(elements);
          svg = await excalidraw.exportToSvg({
            elements: normalizedElements,
            appState: {
              exportBackground: true,
              viewBackgroundColor: '#ffffff',
            },
            files: null,
            exportPadding: 24,
            skipInliningFonts: true,
          });
        } else {
          const validation = validateMermaidSource(source);
          if (validation.error) throw new Error(validation.error);
          const { default: mermaid } = await import('mermaid');
          mermaid.initialize({
            ...createStrictMermaidConfig(),
            theme: theme === 'dark' ? 'dark' : 'neutral',
          });
          const rendered = await mermaid.render(renderId, validation.source);
          svg = sanitizeMermaidSvg(rendered.svg);
        }

        if (cancelled) return;
        host.replaceChildren(document.importNode(prepareSvg(svg, title), true));
        setStatus('ready');
      } catch {
        if (cancelled) return;
        host.replaceChildren();
        setStatus('error');
      }
    }

    renderThumbnail();
    return () => {
      cancelled = true;
    };
  }, [engine, renderId, source, theme, title]);

  return (
    <div className="relative h-full w-full" aria-busy={status === 'loading'}>
      <div ref={hostRef} className="h-full w-full p-3" />
      {status === 'loading' ? (
        <div className="absolute inset-0 flex items-center justify-center text-stone-400">
          <LoaderCircle size={20} className="animate-spin" aria-hidden="true" />
        </div>
      ) : null}
      {status === 'empty' || status === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center text-stone-400">
          <PenTool size={24} aria-hidden="true" />
        </div>
      ) : null}
    </div>
  );
}
