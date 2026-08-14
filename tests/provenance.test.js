import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceFingerprint, isDerivationStale } from '../lib/provenance.js';

test('createSourceFingerprint is stable for identical content', () => {
  const content = '服务端用幂等键识别同一次请求。';
  assert.equal(createSourceFingerprint(content), createSourceFingerprint(content));
});

test('createSourceFingerprint changes when content changes', () => {
  const a = createSourceFingerprint('原文 A');
  const b = createSourceFingerprint('原文 B');
  assert.notEqual(a, b);
});

test('createSourceFingerprint returns empty string for empty content', () => {
  assert.equal(createSourceFingerprint(''), '');
  assert.equal(createSourceFingerprint(undefined), '');
});

test('isDerivationStale returns false when record has no fingerprint (legacy data)', () => {
  assert.equal(isDerivationStale({}, 'any content'), false);
  assert.equal(isDerivationStale({ sourceFingerprint: '' }, 'any content'), false);
});

test('isDerivationStale detects changed source content', () => {
  const original = '服务端用幂等键识别同一次请求。';
  const record = { sourceFingerprint: createSourceFingerprint(original) };
  assert.equal(isDerivationStale(record, original), false);
  assert.equal(isDerivationStale(record, '服务端改用随机键识别同一次请求。'), true);
});
