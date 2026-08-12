'use client';

import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, Minus, Plus, RotateCcw } from 'lucide-react';
import mermaid from 'mermaid';
import {
  MERMAID_ZOOM,
  clampMermaidZoom,
  createMermaidRenderState,
  createStrictMermaidConfig,
  mermaidRenderReducer,
  sanitizeMermaidSvg,
  stepMermaidZoom,
  validateMermaidSource,
} from '@/lib/mermaid-render';

function IconButton({ label, children, disabled = false, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export default function MermaidCanvas({
  source,
  definition,
  code,
  value,
  title = 'Mermaid 图表',
  emptyMessage = '输入 Mermaid DSL 后，图表会显示在这里。',
  className = '',
  initialZoom = MERMAID_ZOOM.initial,
  onRender,
  onError,
}) {
  const hostRef = useRef(null);
  const renderSequenceRef = useRef(0);
  const reactId = useId();
  const [zoom, setZoom] = useState(() => clampMermaidZoom(initialZoom));
  const zoomRef = useRef(zoom);
  const onRenderRef = useRef(onRender);
  const onErrorRef = useRef(onError);
  const [renderState, dispatch] = useReducer(
    mermaidRenderReducer,
    undefined,
    createMermaidRenderState
  );
  const rawSource = source ?? definition ?? code ?? value ?? '';
  const validation = useMemo(() => validateMermaidSource(rawSource), [rawSource]);
  const renderIdPrefix = useMemo(
    () => `anchor-read-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId]
  );

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    onRenderRef.current = onRender;
    onErrorRef.current = onError;
  }, [onError, onRender]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const sequence = renderSequenceRef.current + 1;
    renderSequenceRef.current = sequence;

    if (!validation.source) {
      host.replaceChildren();
      dispatch({ type: 'empty' });
      return undefined;
    }

    if (validation.error) {
      dispatch({ type: 'failure', error: validation.error });
      onErrorRef.current?.(validation.error);
      return undefined;
    }

    let cancelled = false;
    dispatch({ type: 'start' });

    async function renderDiagram() {
      try {
        mermaid.initialize(createStrictMermaidConfig());
        const renderId = `${renderIdPrefix}-${sequence}`;
        const { svg } = await mermaid.render(renderId, validation.source);
        if (cancelled || renderSequenceRef.current !== sequence) return;

        const safeSvg = sanitizeMermaidSvg(svg);
        const mountedSvg = document.importNode(safeSvg, true);
        mountedSvg.removeAttribute('height');
        mountedSvg.style.display = 'block';
        mountedSvg.style.height = 'auto';
        mountedSvg.style.maxWidth = 'none';
        mountedSvg.style.margin = '0 auto';
        mountedSvg.style.width = `${zoomRef.current * 100}%`;
        mountedSvg.setAttribute('role', 'img');
        mountedSvg.setAttribute('aria-label', title);

        host.replaceChildren(mountedSvg);
        dispatch({ type: 'success', source: validation.source });
        onRenderRef.current?.({ source: validation.source, svg: mountedSvg.outerHTML });
      } catch (error) {
        if (cancelled || renderSequenceRef.current !== sequence) return;
        dispatch({ type: 'failure', error });
        onErrorRef.current?.(error);
      }
    }

    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [renderIdPrefix, title, validation.error, validation.source]);

  useEffect(() => {
    const svg = hostRef.current?.querySelector('svg');
    if (svg) svg.style.width = `${zoom * 100}%`;
  }, [zoom]);

  const changeZoom = (direction) => {
    setZoom((current) => stepMermaidZoom(current, direction));
  };

  const hasSource = Boolean(validation.source);
  const isRendering = renderState.status === 'rendering';
  const hasError = renderState.status === 'error';

  return (
    <section
      className={`flex h-full min-h-[360px] flex-col bg-white ${className}`.trim()}
      aria-label={title}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-gray-800">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-400" aria-live="polite">
            {isRendering
              ? '正在渲染'
              : hasError
                ? renderState.hasValidSvg
                  ? '显示上一次成功渲染'
                  : '渲染失败'
                : renderState.hasValidSvg
                  ? '已渲染'
                  : '等待源码'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1" aria-label="图表缩放">
          <IconButton
            label="缩小图表"
            disabled={zoom <= MERMAID_ZOOM.min}
            onClick={() => changeZoom(-1)}
          >
            <Minus aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <span className="w-12 text-center text-xs tabular-nums text-gray-600">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            label="重置缩放"
            disabled={zoom === MERMAID_ZOOM.initial}
            onClick={() => setZoom(MERMAID_ZOOM.initial)}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="放大图表"
            disabled={zoom >= MERMAID_ZOOM.max}
            onClick={() => changeZoom(1)}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-auto bg-gray-50 p-4 md:p-6">
        <div
          ref={hostRef}
          className="mx-auto min-h-full min-w-[20rem] border border-gray-200 bg-white p-4 shadow-sm"
          aria-live="polite"
        />

        {!hasSource && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="max-w-md text-sm leading-6 text-gray-500">{emptyMessage}</p>
          </div>
        )}

        {isRendering && !renderState.hasValidSvg && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-gray-500">
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
            正在渲染 Mermaid 图表
          </div>
        )}

        {isRendering && renderState.hasValidSvg && (
          <div className="pointer-events-none absolute right-6 top-6 flex items-center gap-2 border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 shadow-sm">
            <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            正在更新图表
          </div>
        )}

        {hasError && (
          <div
            role="alert"
            className="absolute bottom-6 left-6 right-6 flex items-start gap-2 border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 shadow-sm"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Mermaid 渲染失败</p>
              <p className="mt-0.5 break-words text-xs leading-5">{renderState.error}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
