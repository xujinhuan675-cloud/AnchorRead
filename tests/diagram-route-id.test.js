import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDiagramRouteId,
  ensureDiagramRouteId,
  getDiagramRouteId,
  isDiagramRouteId,
  normalizeDiagramRouteIds,
} from '../lib/diagram-route-id.js';

test('diagram route ids are short, typed public identifiers', () => {
  const routeId = createDiagramRouteId();
  assert.match(routeId, /^dg-[a-z0-9]{8}$/);
  assert.equal(isDiagramRouteId(routeId), true);
});

test('existing route ids stay stable while legacy drawings receive an alias', () => {
  const stable = { id: 'internal-long-id', routeId: 'dg-k7m2p9x4' };
  assert.equal(ensureDiagramRouteId(stable), stable);
  assert.equal(getDiagramRouteId(stable), 'dg-k7m2p9x4');

  const migrated = ensureDiagramRouteId({ id: 'internal-long-id' });
  assert.equal(migrated.id, 'internal-long-id');
  assert.match(migrated.routeId, /^dg-[a-z0-9]{8}$/);
});

test('normalization repairs duplicate public ids without changing internal ids', () => {
  const drawings = [
    { id: 'internal-1', routeId: 'dg-abcd1234' },
    { id: 'internal-2', routeId: 'dg-abcd1234' },
  ];
  const normalized = normalizeDiagramRouteIds(drawings);
  assert.deepEqual(normalized.map((drawing) => drawing.id), ['internal-1', 'internal-2']);
  assert.equal(new Set(normalized.map((drawing) => drawing.routeId)).size, 2);
});
