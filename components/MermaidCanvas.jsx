'use client';

import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, Minus, Plus, RotateCcw } from 'lucide-react';
import mermaid from 'mermaid';
import { useLocale } from '@/components/LocaleProvider';
import { useAppTheme } from '@/lib/theme';
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
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900 disabled:cursor-not-allowed disabled:opacity-35 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-100"
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
  title = null,
  // 空态副标题：替代默认的「等待源码」状态文案，用来传达创建入口语义（如自由图解工作区）
  subtitle = null,
  // 宿主可注入的头部动作（渲染在放大按钮右侧），如画布级的源码开关
  headerActions = null,
  emptyMessage = null,
  className = '',
  initialZoom = MERMAID_ZOOM.initial,
  onRender,
  onError,
}) {
  const { t } = useLocale();
  // 主题切换后 mermaid 需要按 dark/neutral 重新渲染，theme 进入渲染 effect 依赖
  const { theme } = useAppTheme();
  const resolvedTitle = title ?? t('diagram.mermaidDefaultTitle');
  const resolvedEmptyMessage = emptyMessage ?? t('diagram.mermaidDefaultEmpty');
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
        // 暗色主题下用 dark 主题渲染，浅色保持原有 neutral 观感
        mermaid.initialize({
          ...createStrictMermaidConfig(),
          theme: theme === 'dark' ? 'dark' : 'neutral',
        });
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
        mountedSvg.setAttribute('aria-label', resolvedTitle);

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
  }, [renderIdPrefix, resolvedTitle, theme, validation.error, validation.source]);

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
      className={`flex h-full min-h-[360px] flex-col bg-white dark:bg-stone-900 ${className}`.trim()}
      aria-label={resolvedTitle}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-2.5 dark:border-stone-800">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-stone-800 dark:text-stone-100">{resolvedTitle}</h2>
          <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-400" aria-live="polite">
            {isRendering
              ? t('diagram.statusRendering')
              : hasError
                ? renderState.hasValidSvg
                  ? t('diagram.statusLastSuccess')
                  : t('diagram.statusFailed')
                : renderState.hasValidSvg
                  ? t('diagram.statusRendered')
                  : (subtitle || t('diagram.statusWaiting'))}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1" aria-label={t('diagram.zoomAria')}>
          <IconButton
            label={t('diagram.zoomOut')}
            disabled={zoom <= MERMAID_ZOOM.min}
            onClick={() => changeZoom(-1)}
          >
            <Minus aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <span className="w-12 text-center text-xs tabular-nums text-stone-600 dark:text-stone-300">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            label={t('diagram.zoomReset')}
            disabled={zoom === MERMAID_ZOOM.initial}
            onClick={() => setZoom(MERMAID_ZOOM.initial)}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={t('diagram.zoomIn')}
            disabled={zoom >= MERMAID_ZOOM.max}
            onClick={() => changeZoom(1)}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          {headerActions}
        </div>
      </header>

      {/* 画布区铺满：去掉外边距与卡片描边/阴影，绘图区直接贴边；暗色下铺深色底衬托 SVG */}
      <div className="relative min-h-0 flex-1 overflow-auto bg-white dark:bg-stone-900">
        <div
          ref={hostRef}
          className="min-h-full w-full bg-white p-4 dark:bg-stone-900"
          aria-live="polite"
        />

        {!hasSource && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="max-w-md text-sm leading-6 text-stone-500 dark:text-stone-400">{resolvedEmptyMessage}</p>
          </div>
        )}

        {isRendering && !renderState.hasValidSvg && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
            {t('diagram.renderingOverlay')}
          </div>
        )}

        {isRendering && renderState.hasValidSvg && (
          <div className="pointer-events-none absolute right-6 top-6 flex items-center gap-2 border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600 shadow-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
            <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            {t('diagram.updatingOverlay')}
          </div>
        )}

        {hasError && (
          <div
            role="alert"
            className="absolute bottom-6 left-6 right-6 flex items-start gap-2 border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('diagram.renderFailed')}</p>
              <p className="mt-0.5 break-words text-xs leading-5">{renderState.error}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
