import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('ExcalidrawCanvas accepts a complete persisted scene without breaking the legacy element callback', () => {
  assert.match(componentSource, /appState,\s*\n\s*files,\s*\n\s*onSceneChange,/u);
  assert.match(componentSource, /viewBackgroundColor:\s*isDark\s*\?\s*'#1c1c1c'\s*:\s*'#ffffff'/u);
  assert.match(componentSource, /appState:\s*initialAppState/u);
  assert.match(componentSource, /const hasPersistedAppState = Boolean\(appState &&/u);
  assert.match(componentSource, /scrollToContent:\s*!hasPersistedAppState/u);
  assert.match(componentSource, /convertedElements\.length > 0 && !hasPersistedAppState/u);
  assert.match(componentSource, /\.\.\.\(files === undefined \? \{\} : \{ files \}\)/u);
  assert.match(componentSource, /onChange=\{\(nextElements,\s*nextAppState,\s*nextFiles\)\s*=>/u);
  assert.match(componentSource, /onElementsChange\?\.\(nextElements\)/u);
  assert.match(componentSource, /onSceneChange\?\.\(\{\s*elements:\s*nextElements,\s*appState:\s*nextAppState,\s*files:\s*nextFiles,/u);
  assert.match(componentSource, /nextValue !== undefined\s*&&\s*nextValue !== null/u);
  assert.doesNotMatch(componentSource, /Number\(current\?\.scrollX\)\s*!==\s*Number\(initialAppState\.scrollX\)/u);
});

test('presentation steps update one stable Excalidraw instance', () => {
  assert.match(componentSource, /JSON\.stringify\(elements\.map\(el => el\.id\)\)/u);
  assert.match(componentSource, /restoreFullSceneRef\.current/u);
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
  assert.match(componentSource, /convertToExcalidrawElements\(streamElements\.map\(withLinearPoints\), \{ regenerateIds: false \}\)/u);
  assert.match(componentSource, /excalidrawAPI\.updateScene\(\{ elements: converted \}\)/u);
  assert.match(componentSource, /streamPreviewFittedRef\.current = false/u);
});

test('linear elements get explicit points before official conversion', () => {
  // 官方 convert 的 width||100 回退会把 width:0 的竖直箭头变斜线：
  // 转换前显式补 points（覆盖默认 points），演示与流式预览两条转换路径都要走
  assert.match(componentSource, /function withLinearPoints\(element\)/u);
  assert.match(componentSource, /points: \[\[0, 0\], \[Number\(element\.width\) \|\| 0, Number\(element\.height\) \|\| 0\]\]/u);
  assert.match(componentSource, /convertToExcalidrawElements\(presentationElements\.map\(withLinearPoints\), \{ regenerateIds: false \}\)/u);
});

test('auto zoom yields to the presentation camera', () => {
  // 播放期间自动 fit-zoom 会与步骤相机动画抢视口：每步覆盖相机目标
  assert.match(componentSource, /!hasPersistedAppState && !presentationActive/u);
});

test('presentation auto-advance does not nest setState in an updater', () => {
  // 收尾判定用闭包步索引：updater 必须纯，嵌套 setState 在 dev 双调用下会越界
  // （步进按钮的简洁箭头 updater 是纯的，不在禁止之列）
  assert.doesNotMatch(canvasHostSource, /setPresentationStepIndex\(\(index\) => \{/u);
  assert.match(canvasHostSource, /setPresentationStepIndex\(effectivePresentationStepIndex \+ 1\)/u);
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
  assert.match(diagramHookSource, /JSON\.stringify\(sanitizedAppState\) === JSON\.stringify\(current\.appState\)/u);
  assert.match(diagramHookSource, /JSON\.stringify\(normalized\.files\) === JSON\.stringify\(current\.files\)/u);
  // 运行时容器尺寸字段（width/height/offsetLeft/offsetTop）不得入库，避免倍增循环
  assert.match(diagramHookSource, /delete sanitizedAppState\[key\]/u);
});
