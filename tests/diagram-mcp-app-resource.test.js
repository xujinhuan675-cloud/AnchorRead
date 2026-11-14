import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React, { act, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import {
  DIAGRAM_MCP_APP_MIME_TYPE,
  DIAGRAM_MCP_APP_RESOURCE_URI,
  diagramMcpAppResourceListing,
  readDiagramMcpAppResource,
} from '../lib/diagram-mcp-app-resource.js';

async function withCanvasApp(run, runtimeOverrides = {}) {
  const previousWindow = globalThis.window;
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  globalThis.window = window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const timers = [];
  const root = createRoot(window.document.getElementById('root'));
  const handlersRef = { current: {} };
  let canvasProps;
  const icon = () => null;
  const runtime = {
    Excalidraw: (props) => { canvasProps = props; return React.createElement('canvas'); },
    convertToExcalidrawElements: (elements) => elements.map((element) => ({ ...element, version: 1, opacity: 100 })),
    restoreElements: (elements) => elements,
    FONT_FAMILY: { Excalifont: 5 },
    ChevronLeft: icon, ChevronRight: icon,
    ExternalLink: icon, Eye: icon, Maximize2: icon, Minimize2: icon, Pause: icon, Pencil: icon, Play: icon, Square: icon,
    ...runtimeOverrides,
  };
  const script = readDiagramMcpAppResource().text.match(/<script type="module">([\s\S]*?)<\/script>/u)[1];
  const coreScript = script.slice(script.indexOf('const PSEUDO_ELEMENT_TYPES'), script.indexOf('const root = createRoot'));
  const context = vm.createContext({
    React, useEffect, useMemo, useRef, useState,
    window: { setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout() {} },
    cancelAnimationFrame() {},
  });
  const App = vm.runInContext(coreScript + '\nAnchorReadDiagramAppCore;', context);
  try {
    await act(() => root.render(React.createElement(App, {
      app: { getHostContext: () => ({ displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] }) },
      handlersRef, pendingEventsRef: { current: [] }, runtime,
    })));
    await run({
      document: window.document,
      send: (kind, payload) => act(() => handlersRef.current[kind](payload)),
      getCanvas: () => canvasProps,
      timers,
    });
  } finally {
    await act(() => root.unmount());
    globalThis.window = previousWindow;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
}

test('MCP App hydrates shorthand shapes through the loaded canvas runtime without autoplay', async () => {
  await withCanvasApp(async ({ send, getCanvas, document, timers }) => {
    await send('input', { arguments: { elements: JSON.stringify([
      { id: 'draft', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, label: { text: 'Draft' } },
      { id: 'review', type: 'rectangle', x: 220, y: 0, width: 160, height: 80, label: { text: 'Review' } },
    ]) } });
    assert.ok(document.querySelector('canvas'), 'input must produce a visible canvas instead of an empty placeholder');
    assert.deepEqual(Array.from(getCanvas().initialData.elements, (element) => element.id), ['draft', 'review']);
    assert.equal(getCanvas().viewModeEnabled, true);
    assert.ok(!document.querySelector('.app-title'), 'a loaded diagram must not show instructional text or a fallback title');
    assert.equal(document.querySelector('[aria-label="暂停"]'), null);
    assert.ok(document.querySelector('[aria-label="播放"]'));
    assert.equal(timers.length, 0, 'receiving a diagram must not start a playback timer');
    await send('error', new Error('Unable to load diagram'));
    assert.equal(document.querySelector('[role="status"]').textContent, 'Unable to load diagram');
    await send('input', { arguments: { elements: '[]' } });
    assert.equal(document.querySelector('.app-empty').textContent, '暂无图解内容');
  });
});

test('MCP App shows the complete result scene until playback is explicitly requested', async () => {
  await withCanvasApp(async ({ send, getCanvas, document, timers }) => {
    await send('result', { structured_content: {
      engine: 'excalidraw',
      elements: [{ id: 'draft', type: 'rectangle', version: 1 }, { id: 'review', type: 'rectangle', version: 1 }],
      presentation: { steps: [
        { id: 'first', visibleElementIds: ['draft'], durationMs: 1500 },
        { id: 'second', visibleElementIds: ['draft', 'review'], durationMs: 1500 },
      ] },
    } });
    assert.deepEqual(Array.from(getCanvas().initialData.elements, (element) => element.id), ['draft', 'review']);
    assert.equal(timers.length, 0);
    assert.equal(document.querySelector('[aria-label="暂停"]'), null);
    await act(() => document.querySelector('[aria-label="播放"]').click());
    assert.ok(document.querySelector('[aria-label="暂停"]'));
    assert.equal(timers.length, 1);
  });
});

test('MCP App keeps playback controls minimal until playback starts and returns to minimal controls on stop', async () => {
  await withCanvasApp(async ({ send, document }) => {
    await send('input', { arguments: {
      elements: '[{"id":"draft","type":"rectangle"},{"id":"review","type":"rectangle"}]',
      presentation: { steps: [
        { id: 'first', title: 'Draft', visibleElementIds: ['draft'] },
        { id: 'second', title: 'Review', visibleElementIds: ['draft', 'review'] },
      ] },
    } });
    const controls = () => Array.from(document.querySelectorAll('.app-playback button'), (button) => button.getAttribute('aria-label'));
    assert.deepEqual(controls(), ['播放']);
    assert.equal(document.querySelector('.app-playback select'), null);
    assert.equal(document.querySelector('.app-playback [aria-live]'), null);
    await act(() => document.querySelector('[aria-label="播放"]').click());
    assert.deepEqual(controls(), ['暂停', '上一步', '下一步', '停止']);
    await act(() => document.querySelector('[aria-label="下一步"]').click());
    assert.equal(document.querySelector('[aria-label="下一步"]').disabled, true);
    await act(() => document.querySelector('[aria-label="播放"]').click());
    assert.equal(document.querySelector('[aria-label="下一步"]').disabled, false);
    await act(() => document.querySelector('[aria-label="停止"]').click());
    assert.deepEqual(controls(), ['播放']);
  });
});

test('MCP App leaves playback before editing and keeps the playback bar out of the editor', async () => {
  await withCanvasApp(async ({ send, getCanvas, document }) => {
    await send('input', { arguments: { elements: '[{"id":"draft","type":"rectangle"},{"id":"review","type":"rectangle"}]' } });
    await act(() => document.querySelector('[aria-label="播放"]').click());
    await act(() => document.querySelector('[aria-label="编辑图解"]').click());
    assert.equal(getCanvas().viewModeEnabled, false);
    assert.ok(!document.querySelector('.app-playback'), 'editing must not expose playback controls');
    await act(() => document.querySelector('[aria-label="退出编辑"]').click());
    assert.equal(getCanvas().viewModeEnabled, true);
    assert.ok(document.querySelector('[aria-label="播放"]'));
    assert.equal(document.querySelector('[aria-label="暂停"]'), null);
    assert.equal(document.querySelector('[aria-label="停止"]'), null);
  });
});

test('MCP App pauses the last step in place and replays from the beginning', async () => {
  await withCanvasApp(async ({ send, document, timers }) => {
    await send('input', { arguments: { elements: '[{"id":"draft","type":"rectangle"},{"id":"review","type":"rectangle"}]' } });
    await act(() => document.querySelector('[aria-label="播放"]').click());
    await act(() => timers[0]());
    assert.equal(document.querySelector('[aria-label="下一步"]').disabled, true);
    await act(() => document.querySelector('[aria-label="暂停"]').click());
    assert.equal(document.querySelector('[aria-label="下一步"]').disabled, true);
    await act(() => document.querySelector('[aria-label="播放"]').click());
    assert.equal(document.querySelector('[aria-label="下一步"]').disabled, false);
  });
});

test('MCP App reports conversion errors instead of waiting forever for already received input', async () => {
  await withCanvasApp(async ({ send, document }) => {
    await send('input', { arguments: { elements: '[{"id":"broken","type":"rectangle"}]' } });
    assert.match(document.querySelector('.app-empty').textContent, /图解转换失败.*unsupported shape/u);
    assert.equal(document.querySelector('[aria-label="暂停"]'), null);
  }, { convertToExcalidrawElements: () => { throw new Error('unsupported shape'); } });
});

test('MCP App initializes and buffers input without loading external canvas scripts', { timeout: 2000 }, async () => {
  const resource = readDiagramMcpAppResource();
  const bootstrap = resource.text.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(bootstrap, 'the host handshake must have an inline, network-independent bootstrap');
  const messages = [];
  const listeners = new Set();
  const input = { arguments: { title: 'Early input', elements: '[]' } };
  const result = { content: [], structuredContent: { engine: 'excalidraw', title: 'Early result', elements: [] } };
  const window = {
    addEventListener: (name, handler) => { if (name === 'message') listeners.add(handler); },
    removeEventListener: (name, handler) => { if (name === 'message') listeners.delete(handler); },
    innerWidth: 800,
  };
  const receive = (data) => {
    for (const handler of listeners) handler({ source: window.parent, data });
  };
  window.parent = {
    postMessage: (message) => {
      messages.push(message);
      if (message.method !== 'ui/initialize') return;
      queueMicrotask(() => {
        receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: input });
        receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result });
        receive({ jsonrpc: '2.0', id: message.id, result: {
          protocolVersion: message.params.protocolVersion,
          hostInfo: { name: 'test-host', version: '1.0.0' },
          hostCapabilities: { openLinks: {} },
          hostContext: { displayMode: 'inline' },
        } });
      });
    },
  };
  const root = { textContent: '' };
  const context = vm.createContext({
    window, console: { debug() {}, error() {}, log() {} },
    document: { getElementById: () => root },
    setTimeout, clearTimeout, AbortController, URL, TextEncoder, TextDecoder,
    requestAnimationFrame: () => 1,
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  vm.runInContext(bootstrap, context, { timeout: 1000 });
  try {
    await context.window.anchorReadMcpApp.ready;
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(messages.some((message) => message.method === 'ui/notifications/initialized'));
    const state = context.window.anchorReadMcpApp;
    assert.deepEqual(JSON.parse(JSON.stringify(state.pendingEventsRef.current)), [
      { kind: 'input', payload: input },
      { kind: 'result', payload: result },
    ]);
    assert.equal(state.app.getHostCapabilities().openLinks !== undefined, true);
    const delivered = [];
    state.handlersRef.current.partial = (payload) => delivered.push(payload);
    receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-input-partial', params: input });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(JSON.parse(JSON.stringify(delivered)), [input]);
  } finally {
    await context.window.anchorReadMcpApp.app.close();
  }
});

test('MCP App resource exposes a pinned AnchorRead Excalidraw client', () => {
  const resource = readDiagramMcpAppResource();
  assert.equal(resource.uri, DIAGRAM_MCP_APP_RESOURCE_URI);
  assert.equal(resource.mimeType, DIAGRAM_MCP_APP_MIME_TYPE);
  assert.equal(resource._meta.ui.prefersBorder, true);
  assert.deepEqual(resource._meta.ui.csp.resourceDomains, ['https://esm.sh']);
  assert.match(resource.text, /window\.anchorReadMcpApp/);
  assert.match(resource.text, /const canvasRuntimePromise = Promise\.all\(\[/);
  assert.match(resource.text, /import\('https:\/\/esm\.sh\/@excalidraw\/excalidraw@0\.18\.0/);
  assert.match(resource.text, /import\('https:\/\/esm\.sh\/lucide-react@1\.31\.0/);
  assert.match(resource.text, /import\('https:\/\/esm\.sh\/mermaid@11\.16\.1/);
  assert.doesNotMatch(resource.text, /^\s*import\s+.*(?:@excalidraw|lucide-react|mermaid)/mu);
  assert.doesNotMatch(resource.text, /<link rel="stylesheet" href="https:\/\/esm\.sh\/@excalidraw/);
  assert.match(resource.text, /Promise\.all\(\[ready, canvasRuntimePromise\]\)/);
  assert.match(resource.text, /@excalidraw\/excalidraw@0\.18\.0\/dist\/prod\/index\.css/);
  assert.match(resource.text, /exportToSvg/);
  assert.match(resource.text, /convertToExcalidrawElements, restoreElements, FONT_FAMILY/);
  assert.match(resource.text, /mermaid@11\.16\.1/);
  assert.match(resource.text, /pendingEventsRef/);
  assert.match(resource.text, /ontoolinputpartial/);
  assert.match(resource.text, /cameraUpdate/);
  assert.match(resource.text, /excludeIncompleteLastItem/);
  assert.match(resource.text, /app-playback/);
  assert.match(resource.text, /app-toolbar-actions/);
  assert.match(resource.text, /app-icon-button/);
  assert.ok(!resource.text.includes('const toolbarLabel = status || title'));
  assert.match(resource.text, /aria-label': editing \? '退出编辑' : '编辑图解'/);
  assert.match(resource.text, /engine === 'excalidraw' && !streaming && elements\.length/);
  assert.match(resource.text, /getHostCapabilities\(\)/);
  assert.match(resource.text, /hostSupportsOpenLinks/);
  assert.match(resource.text, /hostSupportsOpenLinks && diagramUrl/);
  assert.match(resource.text, /result\?\.isError/);
  assert.doesNotMatch(resource.text, /window\.open\(diagramUrl/);
  assert.match(resource.text, /viewModeEnabled: !editing/);
  assert.match(resource.text, /UIOptions: \{/);
  assert.match(resource.text, /welcomeScreen: false/);
  assert.match(resource.text, /app-focus-mode \.excalidraw \.App-menu_top/);
  assert.match(resource.text, /app-focus-mode \.excalidraw \.App-menu_bottom/);
  assert.match(resource.text, /main-menu-trigger/);
  assert.match(resource.text, /app-focus-mode \.excalidraw \.App-top-bar/);
  assert.match(resource.text, /app-focus-mode \.excalidraw \.App-bottom-bar/);
  assert.match(resource.text, /app-canvas' \+ \(editing \? ' app-editing' : ' app-focus-mode'\)/);
  assert.match(resource.text, /\.app-canvas \{ position: relative; height: clamp\(360px, 55vh, 620px\)/);
  assert.match(resource.text, /\.app-canvas > \.excalidraw \{ width: 100%; height: 100%; \}/);
  assert.match(resource.text, /api\.scrollToContent\(displayedElements/);
  assert.match(resource.text, /const canvasHostRef = useRef\(null\)/);
  assert.match(resource.text, /new ResizeObserver\(refreshCanvas\)/);
  assert.match(resource.text, /typeof api\.refresh === 'function'/);
  assert.match(resource.text, /presentationStep\?\.camera \|\| typeof api\.scrollToContent/);
  assert.match(resource.text, /observer\?\.observe\(canvasHostRef\.current\)/);
  assert.match(resource.text, /defaultMermaidPresentation/);
  assert.match(resource.text, /DEFAULT_STEP_DURATION_MS = 1500/);
  assert.doesNotMatch(resource.text, /MAX_DEFAULT_PLAYBACK_STEPS/);
  assert.match(resource.text, /function connectorEndpointId/);
  assert.match(resource.text, /const startId = connectorElement\(element\) \? connectorEndpointId/);
  assert.match(resource.text, /const startId = connectorElement\(element\)/);
  assert.match(resource.text, /title: frame\.title/);
  assert.match(resource.text, /focusElementIds: \[\]/);
  assert.match(resource.text, /element\.type === 'text' && element\.containerId/);
  assert.match(resource.text, /'aria-label': presentationPlaying \? '暂停' : '播放'/);
  assert.match(resource.text, /presentationPlaying \? Pause : Play/);
  assert.match(resource.text, /normalizePresentation\(/);
  assert.match(resource.text, /presentationStep\.focusElementIds/);
  assert.match(resource.text, /presentationStep\.camera/);
  assert.match(resource.text, /presentationStep\.highlightElementIds/);
  assert.match(resource.text, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(resource.text, /app-playback-title/);
  assert.doesNotMatch(resource.text, /presentationStepLabel/);
  assert.match(resource.text, /app-display-fullscreen/);
  assert.match(resource.text, /app\.requestDisplayMode\(\{ mode \}\)/);
  assert.match(resource.text, /app\.onhostcontextchanged = updateHostContext/);
  assert.match(resource.text, /value\.openRequested === true/);
  assert.match(resource.text, /app\.openLink\(\{ url: requestedUrl \}\)/);
  assert.match(resource.text, /presentationTransitionDuration\(presentationStep\)/);
  assert.match(resource.text, /presentationStepDuration\(presentationStep\)/);
  assert.match(resource.text, /newlyVisibleIds/);
  assert.match(resource.text, /elementsFitSafeViewport\(readableFocusElements, currentState\)/);
  assert.match(resource.text, /FOCUS_CAMERA_COOLDOWN_MS = 2400/);
  assert.match(resource.text, /React\.createElement\(ChevronLeft/);
  assert.match(resource.text, /React\.createElement\(ChevronRight/);
  assert.match(resource.text, /React\.createElement\(Square/);
  assert.doesNotMatch(resource.text, /presentationPlaying \? '\|\|' : '>'/);
  assert.match(resource.text, /在 AnchorRead 中打开/);
  assert.match(resource.text, /diagramResourceKind/);
  assert.doesNotMatch(resource.text, /diagramWake/);
  assert.match(resource.text, /打开 AnchorRead 图解工作区/);
  assert.match(resource.text, /\.replace\(\/<script\[\\s\\S\]\*\?<\\\/script>\/gi/);
  assert.equal(resource.text.split('</script>').length - 1, 2);
  assert.doesNotMatch(resource.text, /<script\[sS\]\*\?<\/script>/);
  assert.doesNotMatch(resource.text, /\.replace\(\/s\+on\[a-z-\]/);
  assert.match(resource.text, /Prefer the typed result channel when a host does not forward/);
  assert.match(resource.text, /result\?\.structuredContent \?\? result\?\.structured_content/);
  assert.match(resource.text, /value\.engine === 'excalidraw'/);
  assert.match(resource.text, /applyInput\(value, false\)/);
  assert.doesNotMatch(resource.text, /const value = resultValue\(result\)/);
  assert.doesNotMatch(resource.text, /ANCHORREAD_MCP|Bearer\s+/i);
});

test('MCP App embedded scripts remain syntactically valid', () => {
  const resource = readDiagramMcpAppResource();
  const moduleMatch = resource.text.match(/<script type="module">([\s\S]*?)<\/script>/u);
  assert.ok(moduleMatch, 'expected one embedded module script');
  const bootstrap = resource.text.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.doesNotThrow(() => new vm.Script(bootstrap, { filename: 'anchorread-diagram-mcp-bootstrap.js' }));
  assert.doesNotMatch(bootstrap, /\bimport\s*(?:\(|[{*'"])/u);
  const scriptWithoutImports = moduleMatch[1]
    .replace(/^\s*import\s+.*?;\s*$/gmu, '')
    .replace(/^\s*createRoot\(document\.getElementById\('root'\)\).*?;\s*$/gmu, '');
  assert.doesNotThrow(() => new vm.Script(scriptWithoutImports, { filename: 'anchorread-diagram-mcp-app.js' }));
});

test('MCP App resource listing carries the standard app MIME type', () => {
  const listing = diagramMcpAppResourceListing();
  assert.deepEqual(listing, {
    uri: DIAGRAM_MCP_APP_RESOURCE_URI,
    name: 'anchorread-diagram-app',
    title: 'AnchorRead Excalidraw 图解应用',
    description: '在支持 MCP Apps 的客户端内渲染并编辑 AnchorRead 图解。',
    mimeType: DIAGRAM_MCP_APP_MIME_TYPE,
    _meta: { ui: { csp: { resourceDomains: ['https://esm.sh'], connectDomains: ['https://esm.sh'] }, prefersBorder: true } },
  });
});
