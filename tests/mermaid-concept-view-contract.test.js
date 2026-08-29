import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMermaidConceptGraph } from '../lib/mermaid-graph.js';

test('concept graph emits quoted node labels for native SVG text rendering', () => {
  const source = buildMermaidConceptGraph(
    [
      { name: '幂等键' },
      { name: '支付状态' },
    ],
    [{ from: '幂等键', to: '支付状态', type: '相关' }]
  );

  assert.match(source, /concept_0\["幂等键"\]/);
  assert.match(source, /concept_1\["支付状态"\]/);
  assert.match(source, /concept_0 -->\|"相关"\| concept_1/);
});

test('concept view uses the shared strict config and SVG sanitizer', () => {
  const component = readFileSync(
    new URL('../components/MermaidConceptView.jsx', import.meta.url),
    'utf8'
  );

  assert.match(component, /createStrictMermaidConfig/);
  assert.match(component, /sanitizeMermaidSvg/);
  assert.match(component, /const MIN_ZOOM = 0\.1;/);
  assert.match(component, /<CanvasZoomControls/);
  assert.match(component, /containerRef: zoomContainerRef/);
  assert.doesNotMatch(component, /onWheel=\{handleWheel\}/);
  assert.match(component, /className="absolute bottom-3 left-3 z-50"/);
  assert.doesNotMatch(component, /function sanitizeSvg/);
});
