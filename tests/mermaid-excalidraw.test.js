import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_MERMAID_EXCALIDRAW_CONFIG,
  mergeMermaidElementsIntoScene,
} from '../lib/mermaid-excalidraw.js';

const diagramHookSource = readFileSync(
  new URL('../components/reader-lab/use-document-diagram.js', import.meta.url),
  'utf8',
);

test('mermaid merge namespaces ids and preserves bindings, groups, files, and metadata', () => {
  const base = {
    elements: [{ id: 'existing', type: 'rectangle', x: 0, y: 0, width: 100, height: 80 }],
    appState: { viewBackgroundColor: '#f8fafc', scrollX: 12 },
    files: { 'base-file': { mimeType: 'image/png' } },
    customData: { source: 'hand-edited' },
  };
  const imported = [
    {
      id: 'node-a',
      type: 'rectangle',
      x: 0,
      y: 20,
      width: 140,
      height: 60,
      groupIds: ['cluster'],
      boundElements: [{ id: 'label-a', type: 'text' }, { id: 'edge-a', type: 'arrow' }],
    },
    {
      id: 'label-a',
      type: 'text',
      x: 20,
      y: 40,
      width: 60,
      height: 20,
      containerId: 'node-a',
      groupIds: ['cluster'],
    },
    {
      id: 'node-b',
      type: 'rectangle',
      x: 240,
      y: 20,
      width: 140,
      height: 60,
      fileId: 'image-1',
    },
    {
      id: 'edge-a',
      type: 'arrow',
      x: 140,
      y: 50,
      width: 100,
      height: 0,
      points: [[0, 0], [100, 0]],
      startBinding: { elementId: 'node-a', focus: 0 },
      endBinding: { elementId: 'node-b', focus: 0 },
    },
  ];
  const merged = mergeMermaidElementsIntoScene(base, imported, {
    'image-1': { mimeType: 'image/png', data: 'data:image/png;base64,abc' },
  }, { idPrefix: 'diagram-1', gap: 120 });

  assert.equal(merged.scene.elements.length, 5);
  assert.equal(merged.scene.elements[0].id, 'existing');
  assert.equal(merged.scene.customData.source, 'hand-edited');
  assert.equal(merged.scene.appState.scrollX, 12);
  assert.deepEqual(Object.keys(merged.scene.files), ['base-file', 'diagram-1-file-image-1']);

  const byOriginalId = (id) => merged.scene.elements.find((element) => element.id === merged.idMap[id]);
  const nodeA = byOriginalId('node-a');
  const labelA = byOriginalId('label-a');
  const nodeB = byOriginalId('node-b');
  const edge = byOriginalId('edge-a');
  assert.equal(nodeA.x, 220);
  assert.equal(labelA.containerId, nodeA.id);
  assert.deepEqual(nodeA.boundElements, [
    { id: labelA.id, type: 'text' },
    { id: edge.id, type: 'arrow' },
  ]);
  assert.equal(nodeA.groupIds[0], labelA.groupIds[0]);
  assert.equal(nodeB.fileId, 'diagram-1-file-image-1');
  assert.equal(edge.startBinding.elementId, nodeA.id);
  assert.equal(edge.endBinding.elementId, nodeB.id);
  assert.deepEqual(merged.importedElementIds, merged.scene.elements.slice(1).map((element) => element.id));
});

test('mermaid merge can place imported content below an existing scene', () => {
  const merged = mergeMermaidElementsIntoScene(
    [{ id: 'base', type: 'rectangle', x: 10, y: 20, width: 100, height: 50 }],
    [{ id: 'new', type: 'rectangle', x: -10, y: -20, width: 40, height: 30 }],
    {},
    { position: 'below', gap: 40 },
  );
  const imported = merged.scene.elements[1];
  assert.equal(imported.x, 10);
  assert.equal(imported.y, 110);
});

test('official converter defaults stay bounded for browser-side Mermaid conversion', () => {
  assert.equal(DEFAULT_MERMAID_EXCALIDRAW_CONFIG.startOnLoad, false);
  assert.equal(DEFAULT_MERMAID_EXCALIDRAW_CONFIG.flowchart.curve, 'linear');
  assert.equal(DEFAULT_MERMAID_EXCALIDRAW_CONFIG.maxEdges, 500);
});

test('renderer switching converts a Mermaid-only variant instead of persisting an empty Excalidraw scene', () => {
  assert.match(diagramHookSource, /convertMermaidToExcalidrawScene\(code/);
  assert.match(diagramHookSource, /nextElements\.length === 0/);
  assert.match(diagramHookSource, /nextSource = JSON\.stringify\(nextElements, null, 2\)/);
  assert.match(diagramHookSource, /Existing target scenes always win/);
});
