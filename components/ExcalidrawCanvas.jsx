'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo, useRef } from 'react';
import '@excalidraw/excalidraw/index.css';
import { FileCode2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useAppTheme } from '@/lib/theme';
import CanvasToolbarButton from './CanvasToolbarButton';

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

// 官方 convert 对线性元素 width/height 的回退是 `value || DEFAULT`（width 默认 100）：
// width:0 的竖直箭头会被改成 [[0,0],[100,h]] 斜线。这里显式补 points
//（spread 顺序在默认 points 之后可覆盖），保留 0 与负位移。
function withLinearPoints(element) {
  if ((element?.type === 'arrow' || element?.type === 'line') && !Array.isArray(element?.points)) {
    return {
      ...element,
      points: [[0, 0], [Number(element.width) || 0, Number(element.height) || 0]],
    };
  }
  return element;
}

const SHAPE_CONTAINER_TYPES = new Set(['rectangle', 'ellipse', 'diamond']);

function normalizeFontFamilyValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  const names = {
    virgil: 1,
    hand: 1,
    handwritten: 1,
    helvetica: 2,
    sans: 2,
    'sans-serif': 2,
    cascadia: 3,
    mono: 3,
    monospace: 3,
    excalifont: 5,
    nunito: 6,
    lilita: 7,
    'lilita one': 7,
    'comic shanns': 8,
    comic: 8,
  };
  return names[value.trim().toLowerCase()] ?? value;
}

function validateAndFixBindings(elements) {
  const elementMap = new Map(elements.filter((element) => element?.id).map((element) => [element.id, element]));
  return elements.map((element) => {
    const fixed = { ...element };
    if (Array.isArray(fixed.boundElements)) {
      const valid = fixed.boundElements.filter((binding) => (
        binding && typeof binding === 'object'
        && typeof binding.id === 'string'
        && (binding.type === 'text' || binding.type === 'arrow')
        && elementMap.has(binding.id)
      ));
      fixed.boundElements = valid.length > 0 ? valid : null;
    } else if (fixed.boundElements !== undefined && fixed.boundElements !== null) {
      fixed.boundElements = null;
    }
    if (fixed.containerId && !elementMap.has(fixed.containerId)) fixed.containerId = null;
    return fixed;
  });
}

function normalizeImageElement(element) {
  return {
    ...element,
    angle: element.angle ?? 0,
    strokeColor: element.strokeColor ?? 'transparent',
    backgroundColor: element.backgroundColor ?? 'transparent',
    fillStyle: element.fillStyle ?? 'solid',
    strokeWidth: element.strokeWidth ?? 1,
    strokeStyle: element.strokeStyle ?? 'solid',
    roughness: element.roughness ?? 0,
    opacity: element.opacity ?? 100,
    groupIds: element.groupIds ?? [],
    roundness: null,
    seed: element.seed ?? 1,
    version: element.version ?? 1,
    versionNonce: element.versionNonce ?? 1,
    isDeleted: element.isDeleted ?? false,
    boundElements: element.boundElements ?? null,
    link: element.link ?? null,
    locked: element.locked ?? false,
    status: element.status ?? 'saved',
    scale: element.scale ?? [1, 1],
  };
}

function normalizeFreedrawElement(element) {
  return {
    ...element,
    angle: element.angle ?? 0,
    backgroundColor: element.backgroundColor ?? 'transparent',
    fillStyle: element.fillStyle ?? 'solid',
    strokeWidth: element.strokeWidth ?? 1,
    strokeStyle: element.strokeStyle ?? 'solid',
    roughness: element.roughness ?? 1,
    opacity: element.opacity ?? 100,
    groupIds: element.groupIds ?? [],
    roundness: null,
    seed: element.seed ?? 1,
    version: element.version ?? 1,
    versionNonce: element.versionNonce ?? 1,
    isDeleted: element.isDeleted ?? false,
    boundElements: element.boundElements ?? null,
    link: element.link ?? null,
    locked: element.locked ?? false,
    points: Array.isArray(element.points) ? element.points : [[0, 0]],
    pressures: Array.isArray(element.pressures) ? element.pressures : [],
    simulatePressure: element.simulatePressure ?? true,
    lastCommittedPoint: element.lastCommittedPoint ?? null,
  };
}

function restoreElementBindings(convertedElements, originalElements) {
  const originalMap = new Map(originalElements.filter((element) => element?.id).map((element) => [element.id, element]));
  return convertedElements.map((element) => {
    const original = originalMap.get(element.id);
    if (!original) return element;
    const restored = { ...original, ...element };
    const startId = original.startBinding?.elementId || original.start?.id;
    const endId = original.endBinding?.elementId || original.end?.id;
    if (startId && !restored.startBinding) restored.startBinding = { elementId: startId, focus: 0, gap: 4, fixedPoint: null };
    if (endId && !restored.endBinding) restored.endBinding = { elementId: endId, focus: 0, gap: 4, fixedPoint: null };
    if (original.startBinding && !element.startBinding) restored.startBinding = original.startBinding;
    if (original.endBinding && !element.endBinding) restored.endBinding = original.endBinding;
    if (original.boundElements && (!element.boundElements || element.boundElements.length === 0)) {
      restored.boundElements = original.boundElements;
    }
    if (original.containerId && !element.containerId) restored.containerId = original.containerId;
    if (original.elbowed !== undefined && element.elbowed === undefined) restored.elbowed = original.elbowed;
    if (restored.fontFamily !== undefined) restored.fontFamily = normalizeFontFamilyValue(restored.fontFamily);
    return restored;
  });
}

function recenterBoundShapeTextElements(elements) {
  const elementMap = new Map(elements.filter((element) => element?.id).map((element) => [element.id, element]));
  return elements.map((element) => {
    if (element?.type !== 'text' || !element.containerId || element.autoResize === false) return element;
    const container = elementMap.get(element.containerId);
    if (!container || !SHAPE_CONTAINER_TYPES.has(container.type)) return element;
    if (![container.x, container.y, container.width, container.height, element.width, element.height]
      .every((value) => typeof value === 'number')) return element;
    return {
      ...element,
      x: container.x + (container.width - element.width) / 2,
      y: container.y + (container.height - element.height) / 2,
    };
  });
}

// Excalidraw's converter expands labels but can drop server/agent metadata and
// binding fields. Keep those fields while still using the official converter
// for shape/text defaults and generated bound-text elements.
function convertElementsForCanvas(elements, converter) {
  if (!Array.isArray(elements) || elements.length === 0) return [];
  if (elements.every((element) => Number.isFinite(element?.version))) return elements;
  const validated = validateAndFixBindings(elements)
    .map((element) => element?.fontFamily === undefined
      ? element
      : { ...element, fontFamily: normalizeFontFamilyValue(element.fontFamily) });
  const imageElements = validated.filter((element) => element.type === 'image').map(normalizeImageElement);
  const freedrawElements = validated.filter((element) => element.type === 'freedraw').map(normalizeFreedrawElement);
  const convertible = validated
    .filter((element) => element.type !== 'image' && element.type !== 'freedraw')
    .map(withLinearPoints);
  const converted = converter(convertible, { regenerateIds: false });
  return recenterBoundShapeTextElements([
    ...restoreElementBindings(converted, convertible),
    ...imageElements,
    ...freedrawElements,
  ]);
}

// Excalidraw 运行时的画布容器尺寸字段由 Excalidraw 自己管理。
// 持久化后回传会与真实容器尺寸叠加，形成倍增循环（height 逐次翻倍），
// 并把视口推到元素区域之外，导致画布看起来空白。
const RUNTIME_CONTAINER_FIELDS = ['width', 'height', 'offsetLeft', 'offsetTop'];

function withoutRuntimeContainerFields(appState) {
  if (!appState || typeof appState !== 'object') return appState;
  const cleaned = { ...appState };
  for (const key of RUNTIME_CONTAINER_FIELDS) delete cleaned[key];
  return cleaned;
}

// 流式重放相机：移植自官方 cameraUpdate 平滑视口动画（rAF 线性插值）。
// region 形式为场景坐标可见区域，按当前视口尺寸换算 zoom/scroll 并居中；
// 直接形式（scrollX/scrollY/zoom）缺省字段回退当前值。
function resolvePresentationCameraTarget(camera, currentState) {
  const viewportWidth = Number(currentState?.width) || 0;
  const viewportHeight = Number(currentState?.height) || 0;
  const current = {
    scrollX: Number(currentState?.scrollX) || 0,
    scrollY: Number(currentState?.scrollY) || 0,
    zoom: Number(currentState?.zoom?.value) || 1,
  };
  if (camera.region && viewportWidth > 0 && viewportHeight > 0) {
    const { region } = camera;
    const zoom = Math.min(viewportWidth / region.width, viewportHeight / region.height);
    return {
      zoom,
      scrollX: viewportWidth / 2 / zoom - (region.x + region.width / 2),
      scrollY: viewportHeight / 2 / zoom - (region.y + region.height / 2),
    };
  }
  return {
    scrollX: Number.isFinite(Number(camera.scrollX)) ? Number(camera.scrollX) : current.scrollX,
    scrollY: Number.isFinite(Number(camera.scrollY)) ? Number(camera.scrollY) : current.scrollY,
    zoom: Number.isFinite(Number(camera.zoom)) && Number(camera.zoom) > 0 ? Number(camera.zoom) : current.zoom,
  };
}

const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

export default function ExcalidrawCanvas({
  elements,
  onElementsChange,
  appState,
  files,
  onSceneChange,
  presentationStep = null,
  presentationActive = false,
  streamElements = null,
  onExpandPanel = null,
  expandPanelTitle = '',
  onCollapsePanel = null,
  collapsePanelTitle = '',
  onToggleSourceCode = null,
  sourceCodeOpen = false,
  sourceExpandLabel = '',
  sourceCollapseLabel = '',
}) {
  const [convertToExcalidrawElements, setConvertFunction] = useState(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  // MainMenu 与 Excalidraw 同包，动态 import 就绪后才能作为 children 渲染；
  // 就绪前不渲染，保留官方默认菜单，避免闪一下空菜单
  const [MainMenu, setMainMenu] = useState(null);
  const ignoreSceneChangesRef = useRef(false);
  const restoreFullSceneRef = useRef(false);
  const cameraAnimFrameRef = useRef(0);
  const streamPreviewFittedRef = useRef(false);
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
    ...withoutRuntimeContainerFields(appState),
    ...(presentationActive ? { viewModeEnabled: true } : {}),
  }), [appState, isDark, presentationActive]);

  // Load convert function on mount
  useEffect(() => {
    getConvertFunction().then(fn => {
      setConvertFunction(() => fn);
    });
    import('@excalidraw/excalidraw').then((mod) => {
      if (mod.MainMenu) setMainMenu(() => mod.MainMenu);
    });
  }, []);

  // Convert elements to Excalidraw format
  const presentationElements = useMemo(() => {
    if (!presentationActive || !presentationStep) return elements;
    const visible = presentationStep.visibleElementIds?.length ? new Set(presentationStep.visibleElementIds) : null;
    const highlighted = new Set(presentationStep.highlightElementIds || []);
    // 带 label 的元素经转换后会拆出 containerId 绑定的 bound text 元素：
    // 其 id 不在 visibleElementIds 中，需按容器归属一起保留，否则演示态矩形丢失文字标签。
    const isVisible = (element) => !visible
      || visible.has(element.id)
      || (element.containerId && visible.has(element.containerId));
    const isHighlighted = (element) => highlighted.has(element.id)
      || (element.containerId && highlighted.has(element.containerId));
    return (elements || [])
      .filter(isVisible)
      .map((element) => isHighlighted(element) ? {
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
      // 原生元素（带 version）无需转换：convert 函数是异步动态 import，
      // 就绪前返回空数组会让 Excalidraw 以空 initialData 挂载，而原生元素的
      // canvasKey 不随转换就绪变化，空场景永远不会被修正，随后被持久化清空。
      if (presentationElements.every((element) => Number.isFinite(element?.version))) {
        return presentationElements;
      }
      if (!convertToExcalidrawElements) return [];
      // 保留原始元素 id：演示步骤的 visibleElementIds/highlightElementIds 按创建时的
      // 简化元素 id 引用，重新生成随机 id 会让过滤、高亮与持久化后的场景全部失配。
      return convertElementsForCanvas(presentationElements, convertToExcalidrawElements);
    } catch (error) {
      console.error('Failed to convert elements:', error);
      return [];
    }
  }, [presentationElements, convertToExcalidrawElements]);

  // Auto zoom to fit content when API is ready and elements change
  useEffect(() => {
    // 播放期间视口由步骤相机动画驱动：自动 zoom 每步都会覆盖相机目标
    if (excalidrawAPI && convertedElements.length > 0 && !hasPersistedAppState && !presentationActive) {
      // Small delay to ensure elements are rendered
      setTimeout(() => {
        excalidrawAPI.scrollToContent(convertedElements, {
          fitToContent: true,
          animate: true,
          duration: 300,
        });
      }, 100);
    }
  }, [excalidrawAPI, convertedElements, hasPersistedAppState, presentationActive]);

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
        // 平滑相机：rAF 插值到步骤相机目标，流式重放的 cameraUpdate region 在此生效
        const currentState = typeof excalidrawAPI.getAppState === 'function'
          ? excalidrawAPI.getAppState()
          : null;
        const target = resolvePresentationCameraTarget(presentationStep.camera, currentState);
        const from = {
          scrollX: Number(currentState?.scrollX) || 0,
          scrollY: Number(currentState?.scrollY) || 0,
          zoom: Number(currentState?.zoom?.value) || 1,
        };
        const duration = Math.max(120, Math.min(1200, Number(presentationStep.transitionMs) || 450));
        const startedAt = performance.now();
        cancelAnimationFrame(cameraAnimFrameRef.current);
        const tick = (nowTime) => {
          const progress = Math.min(1, (nowTime - startedAt) / duration);
          const k = easeInOutQuad(progress);
          excalidrawAPI.updateScene({
            appState: {
              viewModeEnabled: true,
              scrollX: from.scrollX + (target.scrollX - from.scrollX) * k,
              scrollY: from.scrollY + (target.scrollY - from.scrollY) * k,
              zoom: { value: from.zoom + (target.zoom - from.zoom) * k },
            },
          });
          if (progress < 1) cameraAnimFrameRef.current = requestAnimationFrame(tick);
        };
        cameraAnimFrameRef.current = requestAnimationFrame(tick);
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
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(cameraAnimFrameRef.current);
    };
  }, [excalidrawAPI, convertedElements, presentationActive, presentationStep]);

  // 实时渐进渲染（官方 mcp-app doStream 观感移植）：聊天生成期间每个 SSE chunk
  // 解析出的部分元素经命令式 updateScene 逐个推上画布；canvasKey 基于 elements prop
  // （旧图解）保持稳定不重挂载。期间 ignoreSceneChangesRef 屏蔽 onChange 回写，
  // 防止预览场景被当作正式场景持久化进旧图解；流结束（streamElements 置 null）
  // 走原有 finalize + onCreateDrawing 流程。
  useEffect(() => {
    if (streamElements == null) {
      ignoreSceneChangesRef.current = false;
      streamPreviewFittedRef.current = false;
      return undefined;
    }
    ignoreSceneChangesRef.current = true;
    if (!excalidrawAPI || !convertToExcalidrawElements || streamElements.length === 0) return undefined;
    let converted = [];
    try {
      converted = convertElementsForCanvas(streamElements, convertToExcalidrawElements);
    } catch {
      return undefined;
    }
    if (typeof excalidrawAPI.updateScene !== 'function') return undefined;
    excalidrawAPI.updateScene({ elements: converted });
    if (!streamPreviewFittedRef.current) {
      streamPreviewFittedRef.current = true;
      if (typeof excalidrawAPI.scrollToContent === 'function') {
        excalidrawAPI.scrollToContent(converted, { fitToContent: true, animate: true, duration: 200 });
      }
    }
    return undefined;
  }, [streamElements, excalidrawAPI, convertToExcalidrawElements]);

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
    // 覆盖 Excalidraw 异步应用 updateScene 的过渡期：窗口内任何回调都拦截，
    // 防止过滤后的演示元素被当作正式场景持久化。
    setTimeout(() => { ignoreSceneChangesRef.current = false; }, 800);
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

  // Remount 后 Excalidraw 在 initialData 应用前会触发一次瞬态空 onChange 回调。
  // 记录本实例挂载时的初始元素数：只要初始场景非空，任何空回调都视为瞬态，
  // 不依赖时间窗口，避免把已持久化的场景清空（初始化、重挂载、异步加载等
  // 任意阶段都可能触发空回调，600ms 窗口不可靠）。
  const initialElementCountRef = useRef(0);
  const canvasKeyChangedAtRef = useRef(Date.now());
  useEffect(() => {
    initialElementCountRef.current = convertedElements.length;
    canvasKeyChangedAtRef.current = Date.now();
  }, [canvasKey, convertedElements.length]);

  return (
    <div className="anchor-read-excalidraw relative h-full w-full">
      <Excalidraw
        key={canvasKey}
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        theme={isDark ? 'dark' : 'light'}
        renderTopRightUI={() => {
          // 自定义面板触发器挂在原生 renderTopRightUI 槽位：与 Library 触发器
          // 同一 flex 行并排（CSS 里 order: 99 排到它右侧）；风格用 ar-overlay-*
          // 类，暗色模式由 Excalidraw 根部的 theme--dark 类自动接管。
          // 展开/收起同槽位切换，保证点击位置对称
          if (!onExpandPanel && !onCollapsePanel) return null;
          const togglePanel = onExpandPanel || onCollapsePanel;
          const toggleTitle = onExpandPanel ? expandPanelTitle : collapsePanelTitle;
          return (
            <div className="ar-toolbar-container flex items-center gap-1 rounded bg-[#ececf4] dark:bg-hsl(240,8%,15%) p-0.5" style={{ order: 99 }}>
              <CanvasToolbarButton
                onClick={togglePanel}
                title={toggleTitle}
                aria-label={toggleTitle}
              >
                {onExpandPanel ? <PanelRightOpen size={16} aria-hidden="true" /> : <PanelRightClose size={16} aria-hidden="true" />}
              </CanvasToolbarButton>
            </div>
          );
        }}
        initialData={{
          elements: convertedElements,
          appState: initialAppState,
          ...(files === undefined ? {} : { files }),
          scrollToContent: !hasPersistedAppState,
        }}
        onChange={(nextElements, nextAppState, nextFiles) => {
          // 实例初始数据非空而回调为空：Excalidraw 初始化/重挂载阶段的瞬态
          // 空场景。拒绝持久化，并把已加载的场景恢复到画布，防止任何路径
          // 把非空场景清空（用户主动删除全部元素时同样会被恢复，属安全失败）。
          const emptyWhilePopulated = Array.isArray(nextElements)
            && nextElements.length === 0
            && initialElementCountRef.current > 0;
          if (emptyWhilePopulated) {
            if (!presentationActive && excalidrawAPI && convertedElements.length > 0
              && typeof excalidrawAPI.updateScene === 'function') {
              ignoreSceneChangesRef.current = true;
              excalidrawAPI.updateScene({ elements: convertedElements });
              setTimeout(() => { ignoreSceneChangesRef.current = false; }, 250);
            }
            return;
          }
          if (presentationActive || ignoreSceneChangesRef.current || restoreFullSceneRef.current
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
      >
        {/* 自定义主菜单：源码开关收进菜单作为选项（点击才展开/收起源码区），
            其余保留官方默认项；不传 children 时 Excalidraw 自带默认菜单。
            主题切换由全站统一接管，不重复提供 ToggleTheme */}
        {MainMenu && onToggleSourceCode ? (
          <MainMenu>
            <MainMenu.Item
              icon={<FileCode2 />}
              selected={sourceCodeOpen}
              onSelect={() => onToggleSourceCode()}
            >
              {sourceCodeOpen ? sourceCollapseLabel : sourceExpandLabel}
            </MainMenu.Item>
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        ) : null}
      </Excalidraw>
      {/* 关闭外层的 div */}
    </div>
  );
}

