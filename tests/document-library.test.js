import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentReaderHref,
  deleteDocumentAssets,
  DOCUMENT_OWNED_COLLECTIONS,
  filterAndSortDocuments,
  setDocumentArchived,
} from '../lib/document-library.js';

const documents = [
  { id: 'doc-a', title: 'Reliable systems', category: 'Architecture', status: 'active', createdAt: 10, updatedAt: 20 },
  { id: 'doc-b', title: 'Agent handbook', sourceName: 'agent.md', status: 'archived', createdAt: 30, updatedAt: 40 },
  { id: 'doc-c', title: 'Reading notes', status: 'active', createdAt: 50, updatedAt: 60 },
];
const sessions = {
  'doc-a': { updatedAt: 100 },
  'doc-c': { updatedAt: 80 },
};

test('document library filters active and archived records and searches metadata', () => {
  assert.deepEqual(filterAndSortDocuments({ documents, sessions }).map((item) => item.id), ['doc-a', 'doc-c']);
  assert.deepEqual(filterAndSortDocuments({ documents, sessions, scope: 'archived' }).map((item) => item.id), ['doc-b']);
  assert.deepEqual(filterAndSortDocuments({ documents, sessions, scope: 'all', query: 'architecture' }).map((item) => item.id), ['doc-a']);
  assert.deepEqual(filterAndSortDocuments({ documents, sessions, scope: 'all', query: 'agent.md' }).map((item) => item.id), ['doc-b']);
});

test('document deletion removes every document-owned collection before the source record', async () => {
  const removed = [];
  const repository = Object.fromEntries(DOCUMENT_OWNED_COLLECTIONS.map((name) => [name, {
    list: async (options) => {
      assert.deepEqual(options, { index: 'documentId', query: 'doc-a' });
      return [{ id: `${name}-1` }, { id: `${name}-2` }];
    },
    remove: async (id) => { removed.push(id); },
  }]));
  repository.documents = { remove: async (id) => { removed.push(`document:${id}`); } };
  const sideEffects = [];

  await deleteDocumentAssets({
    repository,
    documentId: 'doc-a',
    flashcards: { removeForDocument: (id) => sideEffects.push(`flashcards:${id}`) },
    histories: { removeForDocument: (id) => sideEffects.push(`histories:${id}`) },
  });

  assert.equal(removed.length, (DOCUMENT_OWNED_COLLECTIONS.length * 2) + 1);
  assert.equal(removed.at(-1), 'document:doc-a');
  assert.deepEqual(sideEffects, ['flashcards:doc-a', 'histories:doc-a']);
});

test('document library supports activity, update, creation and title ordering', () => {
  assert.deepEqual(filterAndSortDocuments({ documents, sessions, scope: 'all' }).map((item) => item.id), ['doc-a', 'doc-c', 'doc-b']);
  assert.deepEqual(filterAndSortDocuments({ documents, sessions, scope: 'all', sort: 'updated' }).map((item) => item.id), ['doc-c', 'doc-b', 'doc-a']);
  assert.deepEqual(filterAndSortDocuments({ documents, sessions, scope: 'all', sort: 'created' }).map((item) => item.id), ['doc-c', 'doc-b', 'doc-a']);
  assert.deepEqual(filterAndSortDocuments({ documents, sessions, scope: 'all', sort: 'title' }).map((item) => item.id), ['doc-b', 'doc-c', 'doc-a']);
});

test('document library hands documents to the reader and archives without mutating input', () => {
  assert.equal(buildDocumentReaderHref({ ...documents[0], routeId: 'doc-k7m2p9x4' }), '/documents/doc-k7m2p9x4');
  assert.equal(buildDocumentReaderHref(null), '/reader-lab');
  const archived = setDocumentArchived(documents[0], true, 200);
  assert.equal(archived.status, 'archived');
  assert.equal(archived.updatedAt, 200);
  assert.equal(documents[0].status, 'active');
  assert.deepEqual(DOCUMENT_OWNED_COLLECTIONS, ['readSessions', 'drawings', 'explanations', 'terms', 'reviewStates']);
});
