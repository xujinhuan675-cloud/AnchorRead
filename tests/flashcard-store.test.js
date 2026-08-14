import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};
globalThis.window = {
  dispatchEvent() {},
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type) { this.type = type; }
};

const { flashcardStore } = await import('../lib/flashcard-store.js');

test('flashcards remain isolated by document id even when titles match', () => {
  flashcardStore.clear();
  flashcardStore.addCards([{ front: '什么是幂等键？', back: '唯一请求标记' }], '同名文章', 'doc-a');
  flashcardStore.addCards([{ front: '什么是幂等键？', back: '另一篇文章的解释' }], '同名文章', 'doc-b');

  assert.equal(flashcardStore.getForDocument('doc-a').length, 1);
  assert.equal(flashcardStore.getForDocument('doc-b').length, 1);
  assert.equal(flashcardStore.getDueCount(Date.now(), 'doc-a'), 1);
  assert.equal(flashcardStore.getForDocument('doc-a')[0].documentId, 'doc-a');
});
