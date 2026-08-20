import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markReaderSampleSeeded,
  READER_DIAGRAM_SAMPLE_SEEDED_KEY,
  shouldSeedReaderSample,
} from '../lib/reader-sample-seeding.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('reader samples are inserted only in a fresh unmarked workspace', () => {
  const storage = createStorage();
  assert.equal(shouldSeedReaderSample({ storage, key: READER_DIAGRAM_SAMPLE_SEEDED_KEY, existingCount: 0 }), true);

  markReaderSampleSeeded(storage, READER_DIAGRAM_SAMPLE_SEEDED_KEY);
  assert.equal(shouldSeedReaderSample({ storage, key: READER_DIAGRAM_SAMPLE_SEEDED_KEY, existingCount: 0 }), false);
});

test('an established workspace is never backfilled with a sample', () => {
  const storage = createStorage();
  assert.equal(shouldSeedReaderSample({ storage, key: READER_DIAGRAM_SAMPLE_SEEDED_KEY, existingCount: 1 }), false);
});
