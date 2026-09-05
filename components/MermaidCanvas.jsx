'use client';

import { useEffect, useId, useMemo, useReducer, useRef } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import mermaid from 'mermaid';
import { useLocale } from '@/components/LocaleProvider';
import { useAppTheme } from '@/lib/theme';
import {
  MERMAID_ZOOM,
  createMermaidRenderState,
  createStrictMermaidConfig,
  mermaidRenderReducer,
  sanitizeMermaidSvg,
  validateMermaidSource,
} from '@/lib/mermaid-render';
import CanvasZoomControls from './CanvasZoomControls';
import useCanvasZoom from './useCanvasZoom';

const MERMAID_VISUAL_SELECTOR = '.node, .edgePath, .edgeLabel, .cluster, .actor, .messageText, .loopText';

function parseSvgViewBox(svg) {
  const values = String(svg?.getAttribute?.('viewBox') || '')
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
    return { x: values[0], y: values[1], width: values[2], height: values[3] };
  }
  const width = Number(svg?.getAttribute?.('width')) || 1;
  const height = Number(svg?.getAttribute?.('height')) || 1;
  return { x: 0, y: 0, width, height };
}

function presentationIdMatches(item, id, index) {
  const value = String(id || '').trim();
  if (!value) return false;
  if (value === `mermaid-${index + 1}` || item?.id === value) return true;
  const descendants = item?.querySelectorAll?.('[id]');
  return Boolean(descendants && [...descendants].some((node) => node.id === value));
}

function matchingVisualItems(items, ids) {
  const requested = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!requested.length) return [];
  return items.filter((item, index) => requested.some((id) => presentationIdMatches(item, id, index)));
}

function isSyntheticMermaidIds(ids) {
  return Array.isArray(ids) && ids.length > 0 && ids.every((id) => /^mermaid-\d+$/u.test(String(id)));
}

function visualItemsBounds(items) {
  const boxes = [];
  for (const item of items) {
    try {
      const box = item.getBBox?.();
      if (box && box.width > 0 && box.height > 0) boxes.push(box);
    } catch {
      // SVG nodes can briefly reject getBBox while Mermaid is still mounting.
    }
  }
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  const paddingX = Math.max(12, (maxX - minX) * 0.16);
  const paddingY = Math.max(12, (maxY - minY) * 0.16);
  return {
    x: minX - paddingX,
    y: minY - paddingY,
    width: Math.max(1, maxX - minX + paddingX * 2),
    height: Math.max(1, maxY - minY + paddingY * 2),
  };
}

function resolveMermaidViewBox(camera, baseViewBox) {
  if (!baseViewBox) return null;
  const region = camera?.region;
  if (region && Number(region.width) > 0 && Number(region.height) > 0) {
    return {
      x: Number(region.x) || 0,
      y: Number(region.y) || 0,
      width: Number(region.width),
      height: Number(region.height),
    };
  }
  const zoom = Number(camera?.zoom);
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const width = baseViewBox.width / scale;
  const height = baseViewBox.height / scale;
  const offsetX = Number.isFinite(Number(camera?.scrollX)) ? Number(camera.scrollX) : 0;
  const offsetY = Number.isFinite(Number(camera?.scrollY)) ? Number(camera.scrollY) : 0;
  return {
    x: baseViewBox.x + (baseViewBox.width - width) / 2 - offsetX,
    y: baseViewBox.y + (baseViewBox.height - height) / 2 - offsetY,
    width,
    height,
  };
}

function interpolateViewBox(from, to, progress) {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    width: from.width + (to.width - from.width) * progress,
    height: from.height + (to.height - from.height) * progress,
  };
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
  presentationStep = null,
  presentationActive = false,
  presentationStepIndex = 0,
  presentationStepCount = 0,
  onRender,
  onError,
}) {
  const { t } = useLocale();
  // 主题切换后 mermaid 需要按 dark/neutral 重新渲染，theme 进入渲染 effect 依赖
  const { theme } = useAppTheme();
  const resolvedTitle = title ?? t('diagram.mermaidDefaultTitle');
  const resolvedEmptyMessage = emptyMessage ?? t('diagram.mermaidDefaultEmpty');
  const hostRef = useRef(null);
  const zoomContainerRef = useRef(null);
  const renderSequenceRef = useRef(0);
  const presentationAnimFrameRef = useRef(0);
  const baseViewBoxRef = useRef(null);
  const currentViewBoxRef = useRef(null);
  const reactId = useId();
  const {
    zoom,
    handleWheel,
    resetZoom,
    zoomIn,
    zoomOut,
  } = useCanvasZoom({
    initialZoom,
    min: MERMAID_ZOOM.min,
    max: MERMAID_ZOOM.max,
    step: MERMAID_ZOOM.step,
    containerRef: zoomContainerRef,
  });
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
        const baseViewBox = parseSvgViewBox(mountedSvg);
        baseViewBoxRef.current = baseViewBox;
        currentViewBoxRef.current = baseViewBox;
        mountedSvg.setAttribute('viewBox', `${baseViewBox.x} ${baseViewBox.y} ${baseViewBox.width} ${baseViewBox.height}`);
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
    if (!svg) return;
    const visualItems = [...svg.querySelectorAll(MERMAID_VISUAL_SELECTOR)];
    const stepCount = Math.max(1, Number(presentationStepCount) || 1);
    const stepNumber = Math.max(1, Math.min(stepCount, Number(presentationStepIndex) + 1));
    const visibleIds = presentationActive && presentationStep ? presentationStep.visibleElementIds || [] : [];
    const syntheticIds = isSyntheticMermaidIds(visibleIds);
    const matchedVisible = syntheticIds ? [] : matchingVisualItems(visualItems, visibleIds);
    const visibleCount = presentationActive && presentationStep
      ? Math.max(1, Math.ceil(visualItems.length * stepNumber / stepCount))
      : visualItems.length;
    visualItems.forEach((item, index) => {
      const visible = presentationActive && presentationStep && visibleIds.length && !syntheticIds && matchedVisible.length
        ? matchedVisible.includes(item)
        : index < visibleCount;
      item.style.opacity = visible ? '' : '0';
      item.style.pointerEvents = visible ? '' : 'none';
      item.style.filter = '';
    });
    if (presentationActive && presentationStep?.highlightElementIds?.length) {
      for (const item of matchingVisualItems(visualItems, presentationStep.highlightElementIds)) {
        item.style.filter = 'drop-shadow(0 0 4px rgba(225, 29, 72, 0.85))';
      }
    }
  }, [presentationActive, presentationStep, presentationStepCount, presentationStepIndex, renderState.renderedSource]);

  useEffect(() => {
    const svg = hostRef.current?.querySelector('svg');
    const baseViewBox = baseViewBoxRef.current;
    if (!svg || !baseViewBox) return undefined;
    const visualItems = [...svg.querySelectorAll(MERMAID_VISUAL_SELECTOR)];
    const focusItems = presentationActive && presentationStep?.focusElementIds?.length
      ? matchingVisualItems(visualItems, presentationStep.focusElementIds)
      : [];
    const focusViewBox = visualItemsBounds(focusItems);
    const target = presentationActive && presentationStep?.camera
      ? resolveMermaidViewBox(presentationStep.camera, baseViewBox)
      : focusViewBox || baseViewBox;
    if (!target) return undefined;
    const from = currentViewBoxRef.current || parseSvgViewBox(svg);
    const transition = Number(presentationStep?.transitionMs);
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 0 : Math.max(0, Math.min(1200, Number.isFinite(transition) ? transition : 450));
    cancelAnimationFrame(presentationAnimFrameRef.current);
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
      const next = interpolateViewBox(from, target, eased);
      svg.setAttribute('viewBox', `${next.x} ${next.y} ${next.width} ${next.height}`);
      currentViewBoxRef.current = next;
      if (progress < 1) presentationAnimFrameRef.current = requestAnimationFrame(tick);
    };
    presentationAnimFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(presentationAnimFrameRef.current);
  }, [presentationActive, presentationStep, renderState.renderedSource]);

  useEffect(() => {
    const svg = hostRef.current?.querySelector('svg');
    if (svg) svg.style.width = `${zoom * 100}%`;
  }, [zoom]);

  const hasSource = Boolean(validation.source);
  const isRendering = renderState.status === 'rendering';
  const hasError = renderState.status === 'error';

  return (
    <section
      className={`relative flex h-full min-h-[360px] flex-col bg-white dark:bg-stone-900 ${className}`.trim()}
      aria-label={resolvedTitle}
      ref={zoomContainerRef}
    >
      {/* 顶部操作同样挂在视口层，避免滚动画布内容把它带走。 */}
      {headerActions && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-[#ececf4] dark:bg-hsl(240,8%,15%) rounded">
          {headerActions}
        </div>
      )}

      {/* 画布区铺满：去掉外边距与卡片描边/阴影，绘图区直接贴边；暗色下铺深色底衬托 SVG */}
      <div
        className="relative min-h-0 flex-1 overflow-auto bg-white dark:bg-stone-900"
      >
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

      {/* 缩放条挂在画布外层，避免内容滚动/放大后跟着 SVG 的坐标移动。 */}
      <CanvasZoomControls
        zoom={zoom}
        min={MERMAID_ZOOM.min}
        max={MERMAID_ZOOM.max}
        initial={MERMAID_ZOOM.initial}
        ariaLabel={t('diagram.zoomAria')}
        zoomOutLabel={t('diagram.zoomOut')}
        zoomResetLabel={t('diagram.zoomReset')}
        zoomInLabel={t('diagram.zoomIn')}
        onZoomOut={zoomOut}
        onReset={resetZoom}
        onZoomIn={zoomIn}
        className="absolute bottom-3 left-3 z-50"
      />
    </section>
  );
}
