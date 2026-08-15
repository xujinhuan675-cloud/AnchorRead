import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKSPACE_DB_VERSION,
  WORKSPACE_SCHEMA,
  WORKSPACE_STORE_NAMES,
  createIndexedDbWorkspaceAdapter,
  createMemoryWorkspaceAdapter,
  createWorkspaceRepository,
  normalizeWorkspaceRecord,
} from '../lib/local-workspace-db.js';

test('declares the complete v3 local workspace schema', () => {
  assert.equal(WORKSPACE_DB_VERSION, 3);
  assert.deepEqual(WORKSPACE_STORE_NAMES, [
    'documents',
    'readSessions',
    'drawings',
    'explanations',
    'terms',
    'reviewStates',
    'customActions',
    'glossary',
  ]);
  assert.equal(WORKSPACE_SCHEMA.readSessions.indexes.documentId.unique, true);
  assert.equal(WORKSPACE_SCHEMA.drawings.indexes.engine.keyPath, 'engine');
  assert.equal(WORKSPACE_SCHEMA.glossary.indexes.normalizedTerm.keyPath, 'normalizedTerm');
});

test('normalizes records without mutating caller data', () => {
  const source = { title: '  Local-first reading  ', content: 'text' };
  const normalized = normalizeWorkspaceRecord('documents', source, {
    now: 42,
    generateId: () => 'document-1',
  });

  assert.deepEqual(source, { title: '  Local-first reading  ', content: 'text' });
  assert.deepEqual(normalized, {
    id: 'document-1',
    title: 'Local-first reading',
    content: 'text',
    status: 'active',
    createdAt: 42,
    updatedAt: 42,
  });
});

test('validates drawing engines and derives normalized terms', () => {
  assert.throws(
    () => normalizeWorkspaceRecord('drawings', { engine: 'svg' }),
    /Drawing engine/
  );
  assert.equal(
    normalizeWorkspaceRecord('terms', { term: '  FSRS  ' }, {
      now: 1,
      generateId: () => 'term-1',
    }).normalizedTerm,
    'fsrs'
  );
});

test('normalizes glossary entries with required terms and deduped aliases', () => {
  const normalized = normalizeWorkspaceRecord('glossary', {
    term: '  幂等键  ',
    aliases: ['Idempotency Key', '幂等键', ''],
    explanation: '  同一意图只产生一次有效结果  ',
  }, { now: 10, generateId: () => 'glossary-1' });

  assert.equal(normalized.term, '幂等键');
  assert.equal(normalized.normalizedTerm, '幂等键');
  assert.deepEqual(normalized.aliases, ['idempotency key']);
  assert.equal(normalized.explanation, '同一意图只产生一次有效结果');
  assert.throws(
    () => normalizeWorkspaceRecord('glossary', { term: '   ' }),
    /主术语不能为空/
  );
});

test('provides collection and generic CRUD through an interchangeable adapter', async () => {
  let nextId = 0;
  const adapter = createMemoryWorkspaceAdapter();
  const repository = createWorkspaceRepository(adapter, {
    now: 100,
    generateId: () => `generated-${++nextId}`,
  });

  const first = await repository.documents.save({ title: 'First' });
  const second = await repository.save('documents', { title: 'Second' });
  await repository.drawings.save({
    id: 'drawing-1',
    documentId: first.id,
    engine: 'mermaid',
    source: 'flowchart TD',
    updatedAt: 200,
  });

  assert.equal((await repository.documents.get(first.id)).title, 'First');
  assert.deepEqual(
    (await repository.documents.list({ index: 'updatedAt', direction: 'prev' }))
      .map((record) => record.id),
    [second.id, first.id]
  );
  assert.equal(
    (await repository.drawings.list({ index: 'documentId', query: first.id })).length,
    1
  );

  assert.equal(await repository.documents.remove(first.id), true);
  assert.equal(await repository.documents.remove(first.id), false);
  assert.equal(await repository.documents.get(first.id), undefined);
  await repository.clear('drawings');
  assert.deepEqual(await repository.drawings.list(), []);
});

test('clearAll clears every workspace collection', async () => {
  const repository = createWorkspaceRepository(createMemoryWorkspaceAdapter(), {
    now: 1,
    generateId: () => 'id',
  });
  await repository.documents.save({ id: 'document', title: 'Document' });
  await repository.terms.save({ id: 'term', term: 'Term' });

  await repository.clearAll();

  for (const storeName of WORKSPACE_STORE_NAMES) {
    assert.deepEqual(await repository.list(storeName), []);
  }
});

test('default IndexedDB adapter is SSR-safe until storage is used', async () => {
  const adapter = createIndexedDbWorkspaceAdapter({ indexedDB: undefined });
  assert.equal(adapter.isAvailable(), false);
  await assert.rejects(adapter.open(), (error) => {
    assert.equal(error.code, 'INDEXEDDB_UNAVAILABLE');
    return true;
  });
});
