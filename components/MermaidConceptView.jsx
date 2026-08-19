'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { buildMermaidConceptGraph } from '@/lib/mermaid-graph';
import { useLocale } from '@/components/LocaleProvider';
import { useAppTheme } from '@/lib/theme';
import {
  createStrictMermaidConfig,
  sanitizeMermaidSvg,
} from '@/lib/mermaid-render';

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.2;

export default function MermaidConceptView({
  concepts = [],
  relations = [],
  title = null,
}) {
  const { t } = useLocale();
  // 概念图随明暗主题重渲染：theme 进入渲染 effect 依赖
  const { theme } = useAppTheme();
  const resolvedTitle = title ?? t('diagram.conceptTitle');
  const hostRef = useRef(null);
  const reactId = useId();
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const definition = useMemo(
    () => buildMermaidConceptGraph(concepts, relations),
    [concepts, relations]
  );
  const renderId = useMemo(
    () => `anchor-read-concept-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId]
  );

  useEffect(() => {
    if (concepts.length === 0 || !hostRef.current) {
      return undefined;
    }

    let cancelled = false;
    const host = hostRef.current;

    async function renderGraph() {
      setStatus('loading');
      setError('');
      try {
        mermaid.initialize({
          ...createStrictMermaidConfig(),
          theme: theme === 'dark' ? 'dark' : 'neutral',
          flowchart: {
            useMaxWidth: true,
            curve: 'basis',
            nodeSpacing: 36,
            rankSpacing: 52,
          },
        });

        const { svg } = await mermaid.render(renderId, definition);
        if (cancelled) return;

        const safeSvg = sanitizeMermaidSvg(svg);
        const mountedSvg = document.importNode(safeSvg, true);
        mountedSvg.removeAttribute('height');
        mountedSvg.style.display = 'block';
        mountedSvg.style.height = 'auto';
        mountedSvg.style.maxWidth = 'none';
        mountedSvg.style.margin = '0 auto';
        mountedSvg.setAttribute('aria-label', resolvedTitle);

        host.replaceChildren(mountedSvg);
        setStatus('ready');
      } catch (caughtError) {
        if (cancelled) return;
        host.replaceChildren();
        setError(caughtError?.message || t('diagram.conceptErrorDefault'));
        setStatus('error');
      }
    }

    renderGraph();
    return () => {
      cancelled = true;
    };
  }, [concepts.length, definition, renderId, resolvedTitle, t, theme]);

  useEffect(() => {
    const svg = hostRef.current?.querySelector('svg');
    if (!svg) return;
    svg.style.width = `${zoom * 100}%`;
  }, [status, zoom]);

  if (concepts.length === 0) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center">
        <div>
          <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{t('diagram.conceptEmptyTitle')}</p>
          <p className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">
            {t('diagram.conceptEmptyHint')}
          </p>
        </div>
      </div>
    );
  }

  const changeZoom = (delta) => {
    setZoom((current) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + delta).toFixed(1))))
    );
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col bg-white dark:bg-stone-900">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-2.5 dark:border-stone-800">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-stone-800 dark:text-stone-100">{resolvedTitle}</h2>
          <p className="mt-0.5 text-xs tabular-nums text-stone-400 dark:text-stone-400">
            {t('diagram.conceptStats', { concepts: concepts.length, relations: relations.length })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1" aria-label={t('diagram.conceptZoomAria')}>
          <button
            type="button"
            onClick={() => changeZoom(-ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            aria-label={t('diagram.conceptZoomOut')}
            title={t('diagram.conceptZoomOutShort')}
            className="flex h-8 w-8 items-center justify-center rounded border border-stone-200 bg-white text-lg leading-none text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-stone-700 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            aria-label={t('diagram.conceptZoomReset')}
            title={t('diagram.zoomReset')}
            className="h-8 min-w-12 rounded border border-stone-200 bg-white px-2 text-xs tabular-nums text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => changeZoom(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            aria-label={t('diagram.conceptZoomIn')}
            title={t('diagram.conceptZoomInShort')}
            className="flex h-8 w-8 items-center justify-center rounded border border-stone-200 bg-white text-lg leading-none text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-stone-700 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10"
          >
            +
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-auto bg-stone-50 p-4 md:p-8 dark:bg-white/5">
        <div
          ref={hostRef}
          className="mx-auto min-w-[36rem] rounded border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
          aria-live="polite"
        />

        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-50/80 text-sm text-stone-500 dark:bg-stone-950/60 dark:text-stone-400">
            {t('diagram.conceptRendering')}
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-300">{t('diagram.conceptRenderFailed')}</p>
              <p className="mt-1 max-w-lg text-xs leading-5 text-red-600 dark:text-red-400">{error}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
