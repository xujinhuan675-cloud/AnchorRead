import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneForTransport } from '../lib/cloneable.js';
import { normalizeWorkspaceRecord } from '../lib/local-workspace-db.js';

test('transport clone makes a drawing safe for IndexedDB and postMessage', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const drawing = {
    id: 'drawing-1',
    engine: 'excalidraw',
    scene: { elements: [{ id: 'element-1', customData: { callback: () => {}, cyclic } }] },
  };
  const cloneableDrawing = cloneForTransport(drawing);
  const channel = new MessageChannel();

  assert.doesNotThrow(() => {
    channel.port1.postMessage({ type: 'drawing-upsert', drawing: cloneableDrawing });
  });
  channel.port1.close();
  channel.port2.close();
  const stored = structuredClone({ type: 'drawing-upsert', drawing: cloneableDrawing });
  assert.equal(stored.drawing.scene.elements[0].customData.callback, undefined);
  assert.equal(stored.drawing.scene.elements[0].customData.cyclic.self, stored.drawing.scene.elements[0].customData.cyclic);
});

test('workspace drawing normalization removes non-cloneable fields before IndexedDB writes', () => {
  const normalized = normalizeWorkspaceRecord('drawings', {
    id: 'drawing-2',
    engine: 'excalidraw',
    scene: { elements: [{ id: 'element-2', customData: { callback: () => {} } }] },
  }, { now: 100 });

  assert.doesNotThrow(() => structuredClone(normalized));
  assert.equal(normalized.scene.elements[0].customData.callback, undefined);
  assert.equal(normalized.updatedAt, 100);
});
