import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagramPath,
  buildDocumentPath,
  buildNewDiagramPath,
  parseWorkspaceResourceLocation,
} from '../lib/workspace-routes.js';

test('workspace resources have stable, encoded detail paths', () => {
  assert.equal(buildDiagramPath('reader drawing/1'), '/diagrams/reader%20drawing%2F1');
  assert.equal(buildDocumentPath('doc/1'), '/documents/doc%2F1');
  assert.equal(buildNewDiagramPath(), '/diagrams/new');
});

test('stable paths resolve to the shared workspace handoff', () => {
  assert.deepEqual(parseWorkspaceResourceLocation('/diagrams/drawing-1', ''), {
    view: 'diagram', drawingId: 'drawing-1', documentId: '', createNew: false, stable: true,
  });
  assert.deepEqual(parseWorkspaceResourceLocation('/documents/doc-1', ''), {
    view: 'read', drawingId: '', documentId: 'doc-1', createNew: false, stable: true,
  });
  assert.deepEqual(parseWorkspaceResourceLocation('/diagrams/new', ''), {
    view: 'diagram', drawingId: '', documentId: '', createNew: true, stable: true,
  });
});

test('legacy query links remain readable during migration', () => {
  assert.deepEqual(parseWorkspaceResourceLocation('/', '?view=diagram&drawing=drawing-1&document=doc-1'), {
    view: 'diagram', drawingId: 'drawing-1', documentId: 'doc-1', createNew: false, stable: false,
  });
  assert.deepEqual(parseWorkspaceResourceLocation('/', '?view=read&document=doc-1'), {
    view: 'read', drawingId: '', documentId: 'doc-1', createNew: false, stable: false,
  });
});
