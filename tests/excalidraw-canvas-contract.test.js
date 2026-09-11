import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  mergeCanvasAppStateForPersistence,
  normalizePersistedExcalidrawAppState,
} from '../lib/excalidraw-app-state.js';
import {
  persistedViewportSyncKey,
  shouldApplyPersistedViewport,
} from '../lib/excalidraw-viewport.js';
import {
  sceneElementsChanged,
  sceneElementsMatch,
} from '../lib/excalidraw-scene-sync.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const componentSource = fs.readFileSync(
  path.join(testDirectory, '..', 'components', 'ExcalidrawCanvas.jsx'),
  'utf8',
);
const diagramHookSource = fs.readFileSync(
  path.join(testDirectory, '..', 'components', 'reader-lab', 'use-document-diagram.js'),
  'utf8',
);
const canvasHostSource = fs.readFileSync(
  path.join(testDirectory, '..', 'components', 'reader-lab', 'DocumentDiagramCanvas.jsx'),
  'utf8',
);
const workspaceSource = fs.readFileSync(
  path.join(testDirectory, '..', 'components', 'ReaderLabWorkspace.jsx'),
  'utf8',
);
const globalStylesSource = fs.readFileSync(
  path.join(testDirectory, '..', 'app', 'globals.css'),
  'utf8',
);

test('ExcalidrawCanvas accepts a complete persisted scene without breaking the legacy element callback', () => {
  assert.match(componentSource, /appState,\s*\n\s*files,\s*\n\s*onSceneChange,/u);
  assert.match(componentSource, /viewBackgroundColor:\s*isDark\s*\?\s*'#1c1c1c'\s*:\s*'#ffffff'/u);
  assert.match(componentSource, /appState:\s*initialAppState/u);
  assert.match(componentSource, /const hasPersistedAppState = Boolean\(appState &&/u);
  assert.match(componentSource, /scrollToContent:\s*!hasPersistedAppState/u);
  assert.match(componentSource, /convertedElements\.length === 0 \|\| hasPersistedAppState \|\| presentationActive/u);
  assert.match(componentSource, /\.\.\.\(files === undefined \? \{\} : \{ files \}\)/u);
  assert.match(componentSource, /onChange=\{\(nextElements,\s*nextAppState,\s*nextFiles\)\s*=>/u);
  assert.match(componentSource, /onElementsChange\?\.\(nextElements\)/u);
  assert.match(componentSource, /onSceneChange\?\.\(\{\s*elements:\s*nextElements,\s*appState:\s*nextAppState,\s*files:\s*nextFiles,/u);
  assert.match(componentSource, /nextValue !== undefined\s*&&\s*nextValue !== null/u);
  assert.doesNotMatch(componentSource, /Number\(current\?\.scrollX\)\s*!==\s*Number\(initialAppState\.scrollX\)/u);
});

test('Excalidraw toolbar and menu props remain referentially stable', () => {
  assert.match(componentSource, /const handleExcalidrawAPI = useCallback\(/u);
  assert.match(componentSource, /const renderTopRightUI = useCallback\(/u);
  assert.match(componentSource, /const mainMenu = useMemo\(/u);
  assert.match(componentSource, /excalidrawAPI=\{handleExcalidrawAPI\}/u);
  assert.match(componentSource, /renderTopRightUI=\{renderTopRightUI\}/u);
  assert.match(componentSource, /\{mainMenu\}/u);
});

test('Mermaid and Excalidraw canvas controls share the global toolbar primitives', () => {
  const mermaidCanvasSource = fs.readFileSync(
    path.join(testDirectory, '..', 'components', 'MermaidCanvas.jsx'),
    'utf8',
  );
  const toolbarSource = fs.readFileSync(
    path.join(testDirectory, '..', 'components', 'CanvasToolbar.jsx'),
    'utf8',
  );
  const toolbarButtonSource = fs.readFileSync(
    path.join(testDirectory, '..', 'components', 'CanvasToolbarButton.jsx'),
    'utf8',
  );
  const canvasMainMenuSource = fs.readFileSync(
    path.join(testDirectory, '..', 'components', 'CanvasMainMenu.jsx'),
    'utf8',
  );

  assert.match(componentSource, /import CanvasToolbar from '\.\/CanvasToolbar';/u);
  assert.match(componentSource, /<CanvasToolbar className="ar-toolbar-container !p-0"/u);
  assert.match(mermaidCanvasSource, /import CanvasToolbar from '\.\/CanvasToolbar';/u);
  assert.match(mermaidCanvasSource, /import CanvasMainMenu from '\.\/CanvasMainMenu';/u);
  assert.match(mermaidCanvasSource, /<CanvasMainMenu\b/u);
  assert.match(mermaidCanvasSource, /<CanvasToolbar className="absolute top-4 right-4 z-10 !p-0">/u);
  assert.match(mermaidCanvasSource, /className="absolute bottom-4 left-4 z-50"/u);
  assert.doesNotMatch(componentSource, /size="large"/u);
  assert.match(toolbarButtonSource, /h-8 w-8/u);
  assert.doesNotMatch(toolbarButtonSource, /sizeClass/u);
  assert.doesNotMatch(toolbarButtonSource, /h-9 w-9 p-0/u);
  assert.match(componentSource, /className="size-4"/u);
  assert.doesNotMatch(componentSource, /size-\[var\(--lg-icon-size,1rem\)\]/u);
  assert.match(toolbarSource, /bg-\[#ececf4\]/u);
  assert.match(toolbarSource, /rounded-lg/u);
  assert.match(toolbarButtonSource, /rounded-lg/u);
  assert.doesNotMatch(canvasHostSource, /size="large"/u);
  assert.match(canvasHostSource, /<CanvasToolbarButton[\s\S]*?<PanelRightOpen size=\{16\} className="size-4"/u);
  assert.match(canvasHostSource, /<PanelRightClose size=\{16\} className="size-4"/u);
  assert.match(canvasMainMenuSource, /<Menu size=\{16\}/u);
  assert.match(canvasMainMenuSource, /hover:bg-\[#f1f0ff\]/u);
  assert.match(canvasMainMenuSource, /dark:hover:bg-\[#363541\]/u);
  assert.match(globalStylesSource, /\.anchor-read-excalidraw \.sidebar-trigger\.default-sidebar-trigger \{/u);
  assert.match(globalStylesSource, /width: 2rem;/u);
  assert.match(globalStylesSource, /height: 2rem;/u);
  assert.match(globalStylesSource, /\.anchor-read-excalidraw \.default-sidebar-trigger \.sidebar-trigger__label \{\s*display: none !important;/u);
  assert.match(globalStylesSource, /\.anchor-read-excalidraw \.sidebar-trigger\.default-sidebar-trigger svg \{/u);
});

test('presentation steps update one stable Excalidraw instance', () => {
  assert.match(componentSource, /JSON\.stringify\(elements\.map\(el => el\.id\)\)/u);
  assert.match(componentSource, /restoreFullSceneRef\.current/u);
  assert.match(componentSource, /opacity: isVisible\(element\) \? \(element\.opacity \?\? 100\) : 0/u);
  assert.match(componentSource, /sceneElementsChanged\(currentElements, convertedElements\)/u);
  assert.match(componentSource, /sceneElementsMatch\(nextElements, convertedElements\)/u);
  assert.match(componentSource, /if \(!convertToExcalidrawElements\) return \[\];/u);
  assert.match(componentSource, /!convertToExcalidrawElements && elements\?\.length > 0/u);
  assert.doesNotMatch(componentSource, /JSON\.stringify\(convertedElements\.map\(el => el\.id\)\)/u);
});

test('empty callbacks cannot wipe a populated scene', () => {
  // 初始场景非空时任何空回调都视为瞬态：拒绝持久化并恢复到画布，
  // 不依赖时间窗口（600ms 窗口在异步加载/重挂载后不可靠）
  assert.match(componentSource, /initialElementCountRef\.current > 0/u);
  assert.match(componentSource, /initialElementCountRef\.current = convertedElements\.length/u);
  assert.match(componentSource, /excalidrawAPI\.updateScene\(\{ elements: convertedElements \}\)/u);
  assert.doesNotMatch(componentSource, /Date\.now\(\) - canvasKeyChangedAtRef\.current < 600/u);
});

test('stream replay camera animates via rAF interpolation', () => {
  // 官方 cameraUpdate 平滑视口动画移植：region 场景坐标换算 + rAF 插值，
  // 步骤切换时取消上一段动画避免叠加
  assert.match(componentSource, /resolvePresentationCameraTarget\(presentationStep\.camera, currentState\)/u);
  assert.match(componentSource, /camera\.region/u);
  assert.match(componentSource, /cancelAnimationFrame\(cameraAnimFrameRef\.current\)/u);
  assert.match(componentSource, /easeInOutQuad/u);
  assert.match(componentSource, /duration === 0 \? 1/u);
  assert.match(componentSource, /prefers-reduced-motion: reduce/u);
});

test('external MCP scene revisions hydrate the mounted canvas without stale writes', () => {
  assert.match(diagramHookSource, /const \[externalSceneRevision, setExternalSceneRevision\] = useState\(0\)/u);
  assert.match(diagramHookSource, /const applyExternalDrawing = useCallback\(/u);
  assert.match(diagramHookSource, /getDiagramRevision\(nextDrawing\) <= getDiagramRevision\(currentDrawing\)/u);
  assert.match(canvasHostSource, /externalSceneRevision,\s*\n\s*\}/u);
  assert.match(canvasHostSource, /externalSceneRevision=\{externalSceneRevision\}/u);
  assert.match(workspaceSource, /diagramStateRef\.current\?\.applyExternalDrawing\?\.\(message\.drawing\)/u);
  assert.match(workspaceSource, /diagramStateRef\.current\?\.applyExternalDrawing\?\.\(drawing\)/u);
  assert.match(componentSource, /externalHydrationRef\.current\.pending/u);
  assert.match(componentSource, /hydration\.revision === externalSceneRevision/u);
  assert.match(componentSource, /excalidrawAPI\.updateScene\(\{/u);
});

test('scene sync detects connector geometry and binding changes', () => {
  const base = [{
    id: 'arrow-1',
    type: 'arrow',
    version: 3,
    x: 0,
    y: 0,
    width: 120,
    height: 0,
    points: [[0, 0], [120, 0]],
    startBinding: null,
    endBinding: null,
    boundElements: null,
  }];
  const moved = [{
    ...base[0],
    points: [[0, 0], [80, 40]],
  }];
  const runtimeVersionOnly = [{ ...base[0], version: 4 }];
  assert.equal(sceneElementsChanged(base, moved), true);
  assert.equal(sceneElementsMatch(base, moved), false);
  assert.equal(sceneElementsMatch(base, runtimeVersionOnly), true);
  assert.equal(sceneElementsMatch(moved, moved), true);
});

test('presentation reveals elements in place and keeps camera movement sparse', () => {
  assert.match(componentSource, /newlyVisibleIds/u);
  assert.match(componentSource, /revealAnimFrameRef/u);
  assert.match(componentSource, /opacity: Math\.round/u);
  assert.match(componentSource, /presentationViewportReadyRef/u);
  assert.match(componentSource, /scrollToContent\(convertedElements/u);
  assert.match(componentSource, /elementsFitSafeViewport\(readableFocusElements, currentState\)/u);
  assert.match(componentSource, /FOCUS_CAMERA_COOLDOWN_MS = 2400/u);
  assert.match(componentSource, /!isConnectorElement\(element\)/u);
});

test('demo end cannot leak filtered elements into persistence', () => {
  // 演示刚结束、完整场景恢复前：onChange 一律拦截，防止过滤后的
  // 演示元素被当作正式场景入库（否则 setElements 引起 canvasKey 重挂载）
  assert.match(componentSource, /presentationActive \|\| ignoreSceneChangesRef\.current \|\| restoreFullSceneRef\.current/u);
});

test('chat generation streams partial elements onto one stable canvas instance', () => {
  // 实时渐进渲染：SSE chunk 部分 JSON 喂给 streamElements，画布命令式
  // updateScene 推增量；预览期间屏蔽 onChange 回写防污染旧图解，
  // 流结束置 null 复位（否则预览场景会被持久化/遗留）
  assert.match(diagramHookSource, /parseStreamSnapshot\(accumulated\)/u);
  assert.match(diagramHookSource, /setStreamElements\(\(previous\) =>/u);
  assert.match(diagramHookSource, /setStreamElements\(null\)/u);
  assert.match(componentSource, /streamElements = null/u);
  assert.match(componentSource, /convertElementsForCanvas\(streamElements, convertToExcalidrawElements\)/u);
  assert.match(componentSource, /excalidrawAPI\.updateScene\(\{ elements: converted \}\)/u);
  assert.match(componentSource, /streamPreviewFittedRef\.current = false/u);
});

test('linear elements get explicit points before official conversion', () => {
  // 官方 convert 的 width||100 回退会把 width:0 的竖直箭头变斜线：
  // 转换前显式补 points（覆盖默认 points），演示与流式预览两条转换路径都要走
  assert.match(componentSource, /function withLinearPoints\(element\)/u);
  assert.match(componentSource, /points: \[\[0, 0\], \[Number\(element\.width\) \|\| 0, Number\(element\.height\) \|\| 0\]\]/u);
  assert.match(componentSource, /convertElementsForCanvas\(presentationElements, convertToExcalidrawElements\)/u);
});

test('browser conversion preserves bindings and media element fields', () => {
  assert.match(componentSource, /function validateAndFixBindings\(elements\)/u);
  assert.match(componentSource, /function normalizeImageElement\(element\)/u);
  assert.match(componentSource, /function normalizeFreedrawElement\(element\)/u);
  assert.match(componentSource, /function restoreElementBindings\(convertedElements, originalElements\)/u);
  assert.match(componentSource, /function recenterBoundShapeTextElements\(elements\)/u);
  assert.match(componentSource, /convertElementsForCanvas\(streamElements, convertToExcalidrawElements\)/u);
});

test('auto zoom yields to the presentation camera', () => {
  // 播放期间自动 fit-zoom 会与步骤相机动画抢视口：每步覆盖相机目标
  assert.match(componentSource, /hasPersistedAppState \|\| presentationActive/u);
  assert.match(componentSource, /autoZoomApiRef\.current === excalidrawAPI/u);
  assert.match(componentSource, /autoZoomTimerRef/u);
});

test('element edits do not reapply an unchanged persisted viewport', () => {
  const savedViewport = persistedViewportSyncKey({
    scrollX: 180,
    scrollY: -72,
    zoom: { value: 0.75 },
  });
  const changedViewport = persistedViewportSyncKey({
    scrollX: 180,
    scrollY: -72,
    zoom: { value: 1.25 },
  });

  assert.equal(shouldApplyPersistedViewport({
    apiChanged: true,
    previousKey: null,
    nextKey: savedViewport,
  }), true);
  // Excalidraw can report a live camera while the parent still owns the same
  // saved key after an element drag. That must not trigger hydration.
  assert.equal(shouldApplyPersistedViewport({
    apiChanged: false,
    previousKey: savedViewport,
    nextKey: savedViewport,
  }), false);
  assert.equal(shouldApplyPersistedViewport({
    apiChanged: false,
    previousKey: savedViewport,
    nextKey: changedViewport,
  }), true);
  assert.equal(shouldApplyPersistedViewport({
    apiChanged: true,
    previousKey: savedViewport,
    nextKey: savedViewport,
  }), true);
});

test('presentation auto-advance does not nest setState in an updater', () => {
  // 收尾判定用闭包步索引：updater 必须纯，嵌套 setState 在 dev 双调用下会越界
  // （步进按钮的简洁箭头 updater 是纯的，不在禁止之列）
  assert.doesNotMatch(canvasHostSource, /setPresentationStepIndex\(\(index\) => \{/u);
  assert.match(canvasHostSource, /setPresentationStepIndex\(effectivePresentationStepIndex \+ 1\)/u);
  assert.match(canvasHostSource, /getPresentationStepPlaybackDuration\(presentationStep, presentationPlaybackRate\)/u);
  assert.match(canvasHostSource, /PRESENTATION_PLAYBACK_RATES\.map/u);
});

test('presentation controls remain bounded on narrow canvases', () => {
  assert.match(canvasHostSource, /max-w-\[calc\(100%-2rem\)\]/u);
  assert.match(canvasHostSource, /<CanvasToolbar floating/u);
  assert.match(canvasHostSource, /<CanvasToolbarButton/u);
  assert.doesNotMatch(canvasHostSource, /ar-overlay-tool/u);
  assert.match(canvasHostSource, /w-24 max-w-\[12rem\]/u);
  assert.match(canvasHostSource, /presentationHasNamedSteps && \(/u);
  assert.doesNotMatch(canvasHostSource, /presentationStepLabel/u);
  assert.match(canvasHostSource, /presentationStepIndex \+ 1\}\/\{presentation\.steps\.length\}/u);
});

test('presentation script reconciles with the current canvas before playback', () => {
  // 生成后再增删改：播放前对账（新增进收尾步 / 整体替换重建），避免空白或漏显
  assert.match(canvasHostSource, /normalizePresentationSpec\(reconcilePresentationSpec\(rawPresentation, elements\)\)/u);
});

test('identical Excalidraw scene changes do not create persistence revisions', () => {
  // 元素比较忽略 Excalidraw 运行时协作字段（versionNonce/updated/seed），
  // 否则每次回调都不同，无变化场景也会反复入库产生修订风暴
  assert.match(diagramHookSource, /stableElementsEqual\(normalized\.elements, current\.elements\)/u);
  assert.match(diagramHookSource, /ELEMENT_RUNTIME_FIELDS = \['versionNonce', 'updated', 'seed'\]/u);
  assert.match(diagramHookSource, /mergeCanvasAppStateForPersistence\(currentAppState, normalized\.appState\)/u);
  assert.match(diagramHookSource, /JSON\.stringify\(persistedAppState\) === JSON\.stringify\(currentAppState\)/u);
  assert.match(diagramHookSource, /JSON\.stringify\(normalized\.files\) === JSON\.stringify\(current\.files\)/u);
  // 运行时容器尺寸字段（width/height/offsetLeft/offsetTop）不得入库，避免倍增循环
  assert.match(diagramHookSource, /const isOwnPersistenceEcho/u);
});

test('canvas runtime state cannot overwrite an explicitly saved viewport', () => {
  const savedAppState = normalizePersistedExcalidrawAppState({
    scrollX: 180,
    scrollY: -72,
    zoom: { value: 1.4 },
    viewBackgroundColor: '#ffffff',
    activeTool: { type: 'selection' },
  });
  const afterPan = mergeCanvasAppStateForPersistence(savedAppState, {
    scrollX: 420,
    scrollY: 96,
    zoom: { value: 0.75 },
    viewBackgroundColor: '#1c1c1c',
    selectedElementIds: { shape: true },
    width: 1024,
    height: 768,
  });

  assert.deepEqual(afterPan, {
    scrollX: 180,
    scrollY: -72,
    zoom: { value: 1.4 },
    viewBackgroundColor: '#1c1c1c',
  });
});

test('Excalidraw import reuses the native main menu and switches to the persisted scene engine', () => {
  assert.match(componentSource, /import \{ FileCode2, PanelRightClose, PanelRightOpen, Upload \}/u);
  assert.match(componentSource, /if \(!MainMenu \|\| \(!onToggleSourceCode && !onImport\)\)/u);
  assert.match(componentSource, /const NATIVE_MENU_ICON_SIZE = 16;/u);
  assert.match(componentSource, /const NATIVE_MENU_ICON_STROKE_WIDTH = 1\.5;/u);
  assert.match(componentSource, /icon=\{<FileCode2 size=\{NATIVE_MENU_ICON_SIZE\} strokeWidth=\{NATIVE_MENU_ICON_STROKE_WIDTH\} \/>\}/u);
  assert.match(componentSource, /icon=\{<Upload size=\{NATIVE_MENU_ICON_SIZE\} strokeWidth=\{NATIVE_MENU_ICON_STROKE_WIDTH\} \/>\}/u);
  assert.match(componentSource, /\{importLabel\}/u);

  const sourceItemIndex = componentSource.indexOf('{onToggleSourceCode && (');
  const importItemIndex = componentSource.indexOf('{onImport && (');
  assert.ok(sourceItemIndex >= 0 && importItemIndex > sourceItemIndex);

  assert.match(canvasHostSource, /onImport=\{canToggleCode \? openImport : null\}/u);
  assert.match(canvasHostSource, /accept="\.excalidraw,application\/json"/u);
  assert.match(diagramHookSource, /const importExcalidrawScene = \(value\) =>/u);
  assert.match(diagramHookSource, /engine: 'excalidraw',[\s\S]*?reason: 'import'/u);
});

test('Excalidraw native menu follows the global application locale', () => {
  assert.match(componentSource, /import \{ useLocale \} from '@\/components\/LocaleProvider';/u);
  assert.match(componentSource, /const \{ locale \} = useLocale\(\);/u);
  assert.match(componentSource, /langCode=\{locale === 'zh-CN' \? 'zh-CN' : 'en'\}/u);
});
