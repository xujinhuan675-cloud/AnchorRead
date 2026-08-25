import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alignScene,
  applyScenePatch,
  createSceneSnapshot,
  describeScene,
  distributeScene,
  duplicateScene,
  groupScene,
  setSceneElementsLocked,
  setSceneViewport,
  ungroupScene,
  getElementBounds,
  querySceneElements,
  restoreSceneSnapshot,
} from '../lib/excalidraw-scene-ops.js';

function scene() {
  return {
    elements: [
      { id: 'a', type: 'rectangle', x: 0, y: 0, width: 40, height: 20, text: 'Start' },
      { id: 'b', type: 'text', x: 120, y: 50, width: 80, height: 20, text: 'Review' },
      { id: 'c', type: 'ellipse', x: 280, y: 100, width: 20, height: 20, locked: true, groupIds: ['g1'] },
      { id: 'arrow', type: 'arrow', x: 40, y: 10, points: [[0, 0], [80, 40]], startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' } },
      { id: 'deleted', type: 'rectangle', x: 10, y: 10, width: 10, height: 10, isDeleted: true },
    ],
    appState: { viewBackgroundColor: '#fff' },
    files: { image: { id: 'image' } },
  };
}

test('query supports type, text, groups, bounds, and excludes deleted elements by default', () => {
  const current = scene();
  assert.deepEqual(querySceneElements(current, { type: 'text' }).map((element) => element.id), ['b']);
  assert.deepEqual(querySceneElements(current, { text: 'review' }).map((element) => element.id), ['b']);
  assert.deepEqual(querySceneElements(current, { groupId: 'g1' }).map((element) => element.id), ['c']);
  assert.deepEqual(querySceneElements(current, { bounds: { x: 0, y: 0, width: 45, height: 25 } }).map((element) => element.id), ['a', 'arrow']);
  assert.equal(querySceneElements(current, { includeDeleted: true }).length, 5);
});

test('bounds include arrow points and description exposes counts, labels, connections, and groups', () => {
  assert.deepEqual(getElementBounds(scene().elements[3]), { x: 40, y: 10, width: 80, height: 40, maxX: 120, maxY: 50 });
  const description = describeScene(scene());
  assert.match(description, /Total elements: 4/);
  assert.match(description, /rectangle\(1\)/);
  assert.match(description, /a --> b \(arrow: arrow\)/);
  assert.match(description, /Group g1: \[c\]/);
});

test('snapshot creation and restore detach scene state', () => {
  const original = scene();
  const snapshot = createSceneSnapshot(original, { name: 'before-edit', createdAt: 42 });
  const restored = restoreSceneSnapshot(snapshot);
  restored.elements[0].x = 999;
  restored.appState.viewBackgroundColor = '#000';
  assert.equal(snapshot.name, 'before-edit');
  assert.equal(snapshot.createdAt, 42);
  assert.equal(original.elements[0].x, 0);
  assert.equal(original.appState.viewBackgroundColor, '#fff');
});

test('scene patches create, update, soft-delete, and hard-delete immutably', () => {
  const original = scene();
  const patched = applyScenePatch(original, {
    create: [{ id: 'new', type: 'diamond', x: 10, y: 10, width: 5, height: 5 }],
    update: [{ id: 'a', text: 'Updated' }],
    delete: ['b'],
  });
  assert.equal(original.elements.find((element) => element.id === 'a').text, 'Start');
  assert.equal(patched.elements.find((element) => element.id === 'a').text, 'Updated');
  assert.equal(patched.elements.find((element) => element.id === 'b').isDeleted, true);
  assert.ok(patched.elements.some((element) => element.id === 'new'));
  const removed = applyScenePatch(patched, { delete: ['b'] }, { hardDelete: true });
  assert.equal(removed.elements.some((element) => element.id === 'b'), false);
});

test('align moves only selected elements and keeps scene metadata', () => {
  const current = scene();
  const aligned = alignScene(current, { ids: ['a', 'b', 'c'], alignment: 'left' });
  const xValues = ['a', 'b', 'c'].map((id) => aligned.elements.find((element) => element.id === id).x);
  assert.deepEqual(xValues, [0, 0, 0]);
  assert.deepEqual(aligned.appState, current.appState);
  assert.deepEqual(aligned.files, current.files);
  assert.equal(current.elements.find((element) => element.id === 'b').x, 120);
});

test('distribute spaces selected elements across their existing span', () => {
  const current = {
    elements: [
      { id: 'a', type: 'rectangle', x: 0, y: 0, width: 20, height: 10 },
      { id: 'b', type: 'rectangle', x: 50, y: 0, width: 10, height: 10 },
      { id: 'c', type: 'rectangle', x: 140, y: 0, width: 20, height: 10 },
    ],
  };
  const distributed = distributeScene(current, { ids: ['a', 'b', 'c'] });
  assert.deepEqual(distributed.elements.map((element) => element.x), [0, 75, 140]);
});

test('groups, ungroups, locks, and duplicates elements without mutating source', () => {
  const current = scene();
  const grouped = groupScene(current, { ids: ['a', 'b'], groupId: 'g2' });
  assert.equal(grouped.groupId, 'g2');
  assert.deepEqual(grouped.scene.elements.find((item) => item.id === 'a').groupIds, ['g2']);
  const ungrouped = ungroupScene(grouped.scene, { groupId: 'g2' });
  assert.deepEqual(ungrouped.scene.elements.find((item) => item.id === 'a').groupIds, []);
  const locked = setSceneElementsLocked(ungrouped.scene, { ids: ['a', 'b'] });
  assert.equal(locked.elements.find((item) => item.id === 'a').locked, true);
  const unlocked = setSceneElementsLocked(locked, { ids: ['a', 'b'], locked: false });
  assert.equal(unlocked.elements.find((item) => item.id === 'a').locked, false);
  const duplicated = duplicateScene(current, { ids: ['a', 'arrow'], offsetX: 10, offsetY: 5 });
  assert.equal(duplicated.elements.length, 2);
  assert.equal(duplicated.elements[0].x, 10);
  assert.equal(duplicated.elements[1].startBinding.elementId, duplicated.idMap.a);
  assert.equal(current.elements.length, 5);
});

test('viewport operation persists camera fields in appState', () => {
  const next = setSceneViewport(scene(), { zoom: 1.5, scrollX: -100, scrollY: 24, viewBackgroundColor: '#eee' });
  assert.equal(next.appState.zoom.value, 1.5);
  assert.equal(next.appState.scrollX, -100);
  assert.equal(next.appState.scrollY, 24);
  assert.equal(next.appState.viewBackgroundColor, '#eee');
});
