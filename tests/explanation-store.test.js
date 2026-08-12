import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createExplanationCacheKey,
  createExplanationStore,
} from '../lib/explanation-store.js';

function createMemoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem() {
      return value;
    },
    setItem(_key, nextValue) {
      value = nextValue;
    },
    removeItem() {
      value = null;
    },
  };
}

test('creates stable cache keys from normalized article and selection text', () => {
  assert.equal(
    createExplanationCacheKey('  article  ', '  selected text  '),
    createExplanationCacheKey('article', 'selected text')
  );
  assert.notEqual(
    createExplanationCacheKey('article one', 'selected text'),
    createExplanationCacheKey('article two', 'selected text')
  );
});

test('stores and returns explanations for the exact article and selection', () => {
  const storage = createMemoryStorage();
  const store = createExplanationStore(storage);
  const explanation = {
    plainExplanation: 'Plain language',
    terms: [],
    context: 'Context',
  };

  store.set('article', 'selected text', explanation);

  assert.deepEqual(store.get('article', 'selected text'), explanation);
  assert.equal(store.get('different article', 'selected text'), null);
  assert.equal(store.get('article', 'different selection'), null);
});

test('recovers from corrupt data and evicts least recently used entries', () => {
  const storage = createMemoryStorage('{not-json');
  const store = createExplanationStore(storage, { maxEntries: 2 });

  assert.equal(store.get('article', 'missing'), null);
  store.set('article', 'first', { plainExplanation: 'first' });
  store.set('article', 'second', { plainExplanation: 'second' });
  assert.deepEqual(store.get('article', 'first'), { plainExplanation: 'first' });
  store.set('article', 'third', { plainExplanation: 'third' });

  assert.equal(store.get('article', 'second'), null);
  assert.deepEqual(store.get('article', 'first'), { plainExplanation: 'first' });
  assert.deepEqual(store.get('article', 'third'), { plainExplanation: 'third' });
});

test('clear removes all cached explanations', () => {
  const storage = createMemoryStorage();
  const store = createExplanationStore(storage);
  store.set('article', 'selected text', { plainExplanation: 'cached' });

  store.clear();

  assert.equal(store.get('article', 'selected text'), null);
});

test('exports and restores cache entries for workspace files', () => {
  const source = createExplanationStore(createMemoryStorage());
  source.set('article', 'selected text', { plainExplanation: 'cached' });

  const target = createExplanationStore(createMemoryStorage());
  target.replaceEntries(source.exportEntries());

  assert.deepEqual(target.get('article', 'selected text'), {
    plainExplanation: 'cached',
  });
});
