import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryWorkspaceAdapter, createWorkspaceRepository } from '../lib/local-workspace-db.js';
import {
  createWorkspaceFilePayload,
  exportWorkspace,
  importWorkspace,
  parseWorkspaceFile,
} from '../lib/workspace-file.js';

test('workspace files contain local content but no application configuration', () => {
  const payload = createWorkspaceFilePayload({
    documents: [{ id: 'doc-1', content: 'local' }],
    configs: [{ apiKey: 'secret' }],
  }, { exportedAt: 1 });

  assert.equal(payload.type, 'anchor-read-workspace');
  assert.equal(payload.version, 3);
  assert.equal(payload.data.documents.length, 1);
  assert.equal('configs' in payload.data, false);
  assert.doesNotMatch(JSON.stringify(payload), /secret/);
});

test('exports and imports all browser workspace collections', async () => {
  const source = createWorkspaceRepository(createMemoryWorkspaceAdapter());
  await source.documents.save({ id: 'doc-1', title: 'Document' });
  await source.drawings.save({
    id: 'drawing-1',
    documentId: 'doc-1',
    engine: 'mermaid',
    source: 'flowchart LR\n  A --> B',
  });

  const payload = await exportWorkspace(source, {
    flashcards: [{ id: 'card-1', documentId: 'doc-1', front: 'Q', back: 'A' }],
    diagramHistory: [{ id: 'history-1', documentId: 'doc-1', drawingId: 'drawing-1' }],
  });
  const target = createWorkspaceRepository(createMemoryWorkspaceAdapter());
  const result = await importWorkspace(target, JSON.stringify(payload));

  assert.equal(result.count, 2);
  assert.equal((await target.documents.get('doc-1')).title, 'Document');
  assert.equal((await target.drawings.get('drawing-1')).engine, 'mermaid');
  assert.equal(result.payload.data.flashcards[0].documentId, 'doc-1');
  assert.equal(result.payload.data.diagramHistory[0].drawingId, 'drawing-1');
  assert.equal('flashcards' in target, false);
});

test('older workspace files default document-scoped extras to empty arrays', () => {
  const payload = parseWorkspaceFile({
    type: 'anchor-read-workspace',
    version: 1,
    data: { documents: [{ id: 'doc-1' }] },
  });

  assert.deepEqual(payload.data.flashcards, []);
  assert.deepEqual(payload.data.diagramHistory, []);
});

test('migrates v1 workspace files to the current version', () => {
  const payload = parseWorkspaceFile({
    type: 'anchor-read-workspace',
    version: 1,
    data: { documents: [{ id: 'doc-1' }], terms: [{ id: 'term-1' }] },
  });

  assert.equal(payload.version, 3);
  assert.deepEqual(payload.data.customActions, []);
  assert.deepEqual(payload.data.glossary, []);
  assert.equal(payload.data.documents.length, 1);
  assert.equal(payload.data.terms.length, 1);
});

test('migrates v2 workspace files by adding an empty glossary and imports glossary entries', async () => {
  const payload = parseWorkspaceFile({
    type: 'anchor-read-workspace',
    version: 2,
    data: { customActions: [{ id: 'action-1' }] },
  });

  assert.equal(payload.version, 3);
  assert.deepEqual(payload.data.glossary, []);
  assert.equal(payload.data.customActions.length, 1);

  const source = createWorkspaceRepository(createMemoryWorkspaceAdapter());
  await source.glossary.save({ term: '幂等键', aliases: ['idempotency key'], explanation: '同一意图只产生一次有效结果' });
  const exported = await exportWorkspace(source);
  assert.equal(exported.data.glossary.length, 1);
  assert.equal(exported.data.glossary[0].normalizedTerm, '幂等键');

  const target = createWorkspaceRepository(createMemoryWorkspaceAdapter());
  const result = await importWorkspace(target, JSON.stringify(exported));
  assert.equal(result.count, 1);
  const restored = await target.glossary.list();
  assert.equal(restored[0].explanation, '同一意图只产生一次有效结果');
});

test('rejects invalid or unsupported workspace files', () => {
  assert.throws(() => parseWorkspaceFile('{broken'), /有效的 JSON/);
  assert.throws(
    () => parseWorkspaceFile({ type: 'anchor-read-workspace', version: 99, data: {} }),
    /高于当前支持/
  );
  assert.throws(
    () => parseWorkspaceFile({ type: 'anchor-read-workspace', version: '1', data: {} }),
    /不支持/
  );
});
