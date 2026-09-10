import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isChunkLoadError,
  recoverChunkLoadError,
} from '../lib/chunk-load-recovery.js';

test('recognizes common Next.js chunk loading failures', () => {
  assert.equal(isChunkLoadError(Object.assign(new Error('Loading chunk 939 failed'), {
    name: 'ChunkLoadError',
  })), true);
  assert.equal(isChunkLoadError(new Error('ordinary application failure')), false);
});

test('reloads at most once for each release and normalized route', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  let reloads = 0;
  const location = {
    pathname: '/diagrams/private-drawing-id',
    reload: () => { reloads += 1; },
  };
  const error = Object.assign(new Error('Loading chunk 939 failed'), { name: 'ChunkLoadError' });

  assert.equal(recoverChunkLoadError(error, { storage, location, release: 'anchor-read@test123' }), true);
  assert.equal(recoverChunkLoadError(error, { storage, location, release: 'anchor-read@test123' }), false);
  assert.equal(reloads, 1);
  assert.equal([...values.keys()][0], 'anchorread.chunk-reload:anchor-read@test123:/diagrams/:drawingId');
});
