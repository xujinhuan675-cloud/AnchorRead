import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MERMAID_MAX_SOURCE_LENGTH,
  MERMAID_ZOOM,
  clampMermaidZoom,
  createMermaidRenderState,
  createStrictMermaidConfig,
  hasUnsafeSvgCss,
  isBlockedSvgElement,
  isSafeSvgReference,
  mermaidRenderReducer,
  normalizeMermaidSource,
  stepMermaidZoom,
  validateMermaidSource,
} from '../lib/mermaid-render.js';

const componentSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'MermaidCanvas.jsx'),
  'utf8',
);
const zoomHookSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'useCanvasZoom.js'),
  'utf8',
);

test('locks Mermaid into strict, non-interactive rendering', () => {
  const config = createStrictMermaidConfig();

  assert.equal(config.securityLevel, 'strict');
  assert.equal(config.startOnLoad, false);
  assert.equal(config.suppressErrorRendering, true);
  assert.equal(config.htmlLabels, false);
  assert.equal(config.maxTextSize, MERMAID_MAX_SOURCE_LENGTH);
  assert.ok(config.secure.includes('securityLevel'));
  assert.ok(config.secure.includes('htmlLabels'));
  assert.ok(config.secure.includes('themeCSS'));
});

test('normalizes fenced DSL and rejects oversized sources', () => {
  assert.equal(
    normalizeMermaidSource('```mermaid\nflowchart LR\n  A --> B\n```'),
    'flowchart LR\n  A --> B'
  );
  assert.equal(validateMermaidSource('flowchart LR\nA-->B').error, '');
  assert.match(validateMermaidSource('x'.repeat(MERMAID_MAX_SOURCE_LENGTH + 1)).error, /不能超过/);
});

test('allows only local SVG fragment references and safe CSS URLs', () => {
  assert.equal(isSafeSvgReference('#node-1'), true);
  assert.equal(isSafeSvgReference('https://example.com/track.svg'), false);
  assert.equal(isSafeSvgReference('javascript:alert(1)'), false);
  assert.equal(hasUnsafeSvgCss('fill: url(#gradient-1)'), false);
  assert.equal(hasUnsafeSvgCss('fill: url(https://example.com/a.svg)'), true);
  assert.equal(hasUnsafeSvgCss('@import url(https://example.com/a.css)'), true);
  assert.equal(isBlockedSvgElement('script'), true);
  assert.equal(isBlockedSvgElement('animate'), true);
  assert.equal(isBlockedSvgElement('set'), true);
  assert.equal(isBlockedSvgElement('path'), false);
});

test('clamps and steps canvas zoom predictably', () => {
  assert.equal(MERMAID_ZOOM.min, 0.1);
  assert.equal(clampMermaidZoom(0), MERMAID_ZOOM.min);
  assert.equal(clampMermaidZoom(9), MERMAID_ZOOM.max);
  assert.equal(stepMermaidZoom(1, 1), 1.25);
  assert.equal(stepMermaidZoom(MERMAID_ZOOM.min, -1), MERMAID_ZOOM.min);
});

test('keeps Mermaid zoom controls fixed to the canvas viewport', () => {
  assert.match(componentSource, /<section\s+className=\{`relative flex h-full/u);
  assert.match(componentSource, /缩放条挂在画布外层/u);
  assert.match(componentSource, /<CanvasZoomControls/u);
  assert.match(componentSource, /className="absolute bottom-3 left-3 z-50"/u);
  assert.match(componentSource, /顶部操作同样挂在视口层/u);
  assert.match(componentSource, /overflow-auto bg-white dark:bg-stone-900/u);
});

test('shares Excalidraw-style Ctrl/Cmd wheel zoom behavior', () => {
  assert.match(componentSource, /containerRef: zoomContainerRef/u);
  assert.doesNotMatch(componentSource, /onWheel=\{handleWheel\}/u);
  assert.match(zoomHookSource, /event\.ctrlKey \|\| event\.metaKey/u);
  assert.match(zoomHookSource, /event\.preventDefault\(\)/u);
  assert.match(zoomHookSource, /addEventListener\('wheel', handleWheel, options\)/u);
  assert.match(zoomHookSource, /passive: false/u);
  assert.match(zoomHookSource, /capture: true/u);
  assert.match(zoomHookSource, /boundedDelta/u);
});

test('render failures preserve the last successful diagram contract', () => {
  const initial = createMermaidRenderState();
  const rendering = mermaidRenderReducer(initial, { type: 'start' });
  const ready = mermaidRenderReducer(rendering, {
    type: 'success',
    source: 'flowchart LR\nA-->B',
  });
  const updating = mermaidRenderReducer(ready, { type: 'start' });
  const failed = mermaidRenderReducer(updating, {
    type: 'failure',
    error: new Error('Parse error'),
  });

  assert.equal(failed.status, 'error');
  assert.equal(failed.hasValidSvg, true);
  assert.equal(failed.renderedSource, ready.renderedSource);
  assert.equal(failed.error, 'Parse error');
});
