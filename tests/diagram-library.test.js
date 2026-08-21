import assert from 'node:assert/strict';
import test from 'node:test';
import { STANDALONE_DIAGRAM_DOCUMENT_ID } from '../lib/diagram-generation.js';
import {
  buildDiagramEditorHref,
  buildNewDiagramHref,
  duplicateDrawing,
  filterAndSortDrawings,
} from '../lib/diagram-library.js';

const drawings = [
  { id: 'free-1', routeId: 'dg-k7m2p9x4', documentId: STANDALONE_DIAGRAM_DOCUMENT_ID, title: 'Agent map', engine: 'excalidraw', createdAt: 1, updatedAt: 5 },
  { id: 'doc-1-drawing', documentId: 'doc-1', title: 'Overview', engine: 'mermaid', createdAt: 3, updatedAt: 4 },
  { id: 'doc-2-drawing', documentId: 'doc-2', title: 'Timeline', engine: 'mermaid', createdAt: 2, updatedAt: 6 },
];
const documents = [
  { id: 'doc-1', title: 'Reliable systems' },
  { id: 'doc-2', title: 'Product history' },
];

test('diagram library filters by ownership, renderer, title and source document', () => {
  assert.deepEqual(filterAndSortDrawings({ drawings, documents, scope: 'freeform' }).map((item) => item.id), ['free-1']);
  assert.deepEqual(filterAndSortDrawings({ drawings, documents, scope: 'document', renderer: 'mermaid' }).map((item) => item.id), ['doc-2-drawing', 'doc-1-drawing']);
  assert.deepEqual(filterAndSortDrawings({ drawings, documents, query: 'reliable' }).map((item) => item.id), ['doc-1-drawing']);
});

test('diagram library supports created and updated ordering', () => {
  assert.deepEqual(filterAndSortDrawings({ drawings, documents }).map((item) => item.id), ['doc-2-drawing', 'free-1', 'doc-1-drawing']);
  assert.deepEqual(filterAndSortDrawings({ drawings, documents, sort: 'created' }).map((item) => item.id), ['doc-1-drawing', 'doc-2-drawing', 'free-1']);
});

test('diagram library routes selected assets and new creation into the editor', () => {
  assert.equal(buildDiagramEditorHref(drawings[0]), '/diagrams/dg-k7m2p9x4');
  assert.equal(buildNewDiagramHref(), '/diagrams/new');
});

test('duplicating a drawing preserves content without preserving demo identity', () => {
  const duplicate = duplicateDrawing({ ...drawings[0], isLocalDemo: true, source: '[1]' }, {
    id: 'copy-1',
    now: 10,
    titleSuffix: 'copy',
  });
  assert.equal(duplicate.id, 'copy-1');
  assert.equal(duplicate.title, 'Agent map copy');
  assert.equal(duplicate.source, '[1]');
  assert.equal(duplicate.isLocalDemo, false);
  assert.equal(duplicate.routeId, undefined);
  assert.equal(duplicate.createdAt, 10);
});
