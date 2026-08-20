export const READER_DOCUMENT_SAMPLES_SEEDED_KEY = 'anchor-read-document-samples-seeded-v1';
export const READER_DIAGRAM_SAMPLE_SEEDED_KEY = 'anchor-read-diagram-sample-seeded-v1';

export function shouldSeedReaderSample({ storage, key, existingCount = 0 } = {}) {
  if (Number(existingCount) > 0) return false;
  try {
    return storage?.getItem(key) !== '1';
  } catch {
    return true;
  }
}

export function markReaderSampleSeeded(storage, key) {
  try {
    storage?.setItem(key, '1');
  } catch {
    // IndexedDB remains usable when localStorage is unavailable; seeding is still idempotent per restore.
  }
}
