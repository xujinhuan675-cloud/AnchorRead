import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDocumentRouteId,
  ensureDocumentRouteId,
  findDocumentByRouteId,
  getDocumentRouteId,
  isDocumentRouteId,
  normalizeDocumentRouteIds,
} from '../lib/document-route-id.js';

test('document route ids are short, typed public identifiers', () => {
  const routeId = createDocumentRouteId();
  assert.match(routeId, /^doc-[a-z0-9]{8}$/);
  assert.equal(isDocumentRouteId(routeId), true);
});

test('existing document route ids stay stable while internal ids remain unchanged', () => {
  const stable = { id: 'reader-lab-document-long-id', routeId: 'doc-k7m2p9x4' };
  assert.equal(ensureDocumentRouteId(stable), stable);
  assert.equal(getDocumentRouteId(stable), 'doc-k7m2p9x4');

  const migrated = ensureDocumentRouteId({ id: 'reader-lab-document-long-id' });
  assert.equal(migrated.id, 'reader-lab-document-long-id');
  assert.match(migrated.routeId, /^doc-[a-z0-9]{8}$/);
});

test('document routes resolve both legacy internal ids and short public ids', () => {
  const document = { id: 'reader-lab-document-long-id', routeId: 'doc-k7m2p9x4' };
  assert.equal(findDocumentByRouteId([document], document.id), document);
  assert.equal(findDocumentByRouteId([document], document.routeId), document);
  assert.equal(findDocumentByRouteId([document], 'doc-missing0'), undefined);
});

test('document route normalization repairs duplicate aliases', () => {
  const documents = [
    { id: 'internal-1', routeId: 'doc-abcd1234' },
    { id: 'internal-2', routeId: 'doc-abcd1234' },
  ];
  const normalized = normalizeDocumentRouteIds(documents);
  assert.deepEqual(normalized.map((document) => document.id), ['internal-1', 'internal-2']);
  assert.equal(new Set(normalized.map((document) => document.routeId)).size, 2);
});
