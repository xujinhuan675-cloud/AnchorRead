import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.equal(clampMermaidZoom(0), MERMAID_ZOOM.min);
  assert.equal(clampMermaidZoom(9), MERMAID_ZOOM.max);
  assert.equal(stepMermaidZoom(1, 1), 1.25);
  assert.equal(stepMermaidZoom(MERMAID_ZOOM.min, -1), MERMAID_ZOOM.min);
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
