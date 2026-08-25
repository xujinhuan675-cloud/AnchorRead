import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectExcalidrawFormat,
  getExcalidrawSceneElements,
  isExcalidrawScene,
  normalizeExcalidrawScene,
  parseExcalidrawScene,
  serializeExcalidrawScene,
} from '../lib/excalidraw-scene.js';

const elements = [
  { id: 'text-1', type: 'text', x: 10, y: 20, text: 'Anchor Read' },
];

test('detects legacy element arrays and complete Excalidraw scenes', () => {
  assert.equal(detectExcalidrawFormat(elements), 'elements');
  assert.equal(detectExcalidrawFormat(JSON.stringify(elements)), 'elements');
  assert.equal(detectExcalidrawFormat({ type: 'excalidraw', elements }), 'scene');
  assert.equal(detectExcalidrawFormat('{"not":"a scene"}'), 'invalid');
  assert.equal(isExcalidrawScene({ type: 'excalidraw', elements }), true);
});

test('promotes legacy source to a normalized scene without mutating input', () => {
  const legacy = [{ ...elements[0], custom: { nested: true } }];
  const scene = normalizeExcalidrawScene(legacy);

  assert.equal(scene.type, 'excalidraw');
  assert.equal(scene.version, 2);
  assert.equal(scene.source, 'anchor-read');
  assert.deepEqual(scene.elements, legacy);
  assert.deepEqual(scene.appState, {
    viewBackgroundColor: '#ffffff',
    gridSize: null,
    exportBackground: true,
  });
  assert.deepEqual(scene.files, {});
  scene.elements[0].custom.nested = false;
  assert.equal(legacy[0].custom.nested, true);
});

test('preserves scene metadata and normalizes appState and files', () => {
  const input = {
    type: 'excalidraw',
    version: 1,
    source: 'external-tool',
    name: 'Imported diagram',
    elements,
    appState: { viewBackgroundColor: '#111111', zoom: { value: 1.25 } },
    files: { 'image-1': { mimeType: 'image/png', data: 'base64' } },
  };
  const scene = parseExcalidrawScene(input);

  assert.equal(scene.version, 2);
  assert.equal(scene.source, 'external-tool');
  assert.equal(scene.name, 'Imported diagram');
  assert.equal(scene.appState.viewBackgroundColor, '#111111');
  assert.equal(scene.appState.gridSize, null);
  assert.equal(scene.appState.zoom.value, 1.25);
  assert.deepEqual(scene.files, input.files);
});

test('serializes a complete scene and round-trips through the parser', () => {
  const serialized = serializeExcalidrawScene(elements, { space: 0 });
  assert.match(serialized, /"type":"excalidraw"/);
  assert.match(serialized, /"appState":\{/);
  assert.deepEqual(parseExcalidrawScene(serialized).elements, elements);
  assert.deepEqual(getExcalidrawSceneElements(serialized), elements);
});

test('accepts fenced JSON pasted from an AI response', () => {
  const pasted = `\`\`\`json\n${JSON.stringify({ elements })}\n\`\`\``;
  assert.deepEqual(parseExcalidrawScene(pasted).elements, elements);
});

test('rejects malformed scene shapes with actionable errors', () => {
  assert.throws(
    () => parseExcalidrawScene({ elements: 'nope' }),
    /elements array/iu
  );
  assert.throws(
    () => parseExcalidrawScene({ elements: [null] }),
    /element at index 0/iu
  );
  assert.throws(
    () => parseExcalidrawScene({ elements, files: [] }),
    /files must be an object map/iu
  );
});

