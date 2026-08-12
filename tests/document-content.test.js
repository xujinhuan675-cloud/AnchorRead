import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markdownFragmentToText,
  prepareDocumentHighlights,
} from '../lib/document-content.js';

test('converts Markdown highlight fragments to their rendered text', () => {
  assert.equal(
    markdownFragmentToText('相同请求返回 `409 REQUEST_IN_PROGRESS`。'),
    '相同请求返回 409 REQUEST_IN_PROGRESS。'
  );
  assert.equal(
    markdownFragmentToText('**幂等键**详见 [接口文档](/docs)。'),
    '幂等键详见 接口文档。'
  );
});

test('keeps source text for occurrence lookup and exposes rendered text', () => {
  const source = '状态为 `PENDING` 时不能判定失败。';
  const [highlight] = prepareDocumentHighlights(source, [{
    text: '`PENDING` 时不能判定失败',
    level: 'concept',
    reason: '状态语义',
  }]);

  assert.equal(highlight.text, '`PENDING` 时不能判定失败');
  assert.equal(highlight.documentText, 'PENDING 时不能判定失败');
  assert.equal(highlight.preferredOccurrence, 0);
});
