import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitDiagramScene,
  findDiagramRevision,
  getDiagramRevision,
  getDrawingScene,
  restoreDiagramRevision,
} from '../lib/diagram-scene-record.js';

function drawing() {
  return {
    id: 'drawing-1',
    documentId: 'doc-1',
    engine: 'excalidraw',
    source: JSON.stringify([{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }]),
    createdAt: 1,
    updatedAt: 1,
  };
}

test('commits a canonical scene and preserves legacy source compatibility', () => {
  const next = commitDiagramScene(drawing(), {
    elements: [{ id: 'a', type: 'rectangle', x: 30, y: 0, width: 10, height: 10 }],
    appState: { scrollX: -12 },
    files: {},
  }, { author: 'agent', reason: 'layout', now: 42 });
  assert.equal(getDiagramRevision(next), 1);
  assert.equal(next.scene.appState.scrollX, -12);
  assert.deepEqual(JSON.parse(next.source), next.scene.elements);
  assert.equal(next.revisionHistory.length, 1);
  assert.equal(next.revisionHistory[0].author, 'agent');
  assert.equal(getDrawingScene(next).elements[0].x, 30);
});

test('rejects stale commits without mutating the drawing', () => {
  const current = commitDiagramScene(drawing(), { elements: [] }, { now: 10 });
  assert.throws(
    () => commitDiagramScene(current, { elements: [{ id: 'b', type: 'text' }] }, { expectedRevision: 0 }),
    (error) => error.code === 'REVISION_CONFLICT' && error.actualRevision === 1,
  );
  assert.equal(current.revision, 1);
});

test('finds and restores bounded revisions', () => {
  let current = drawing();
  current = commitDiagramScene(current, { elements: [{ id: 'a', type: 'text', text: 'one' }] }, { now: 2 });
  const first = findDiagramRevision(current, 1);
  current = commitDiagramScene(current, { elements: [{ id: 'a', type: 'text', text: 'two' }] }, { expectedRevision: 1, now: 3 });
  const restored = restoreDiagramRevision(current, first.id, { expectedRevision: 2, now: 4 });
  assert.equal(restored.revision, 3);
  assert.equal(restored.scene.elements[0].text, 'one');
});

