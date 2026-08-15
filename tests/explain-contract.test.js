import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExplainPrompt } from '../lib/article-prompts.js';
import {
  ExplainRequestError,
  ExplainResponseError,
  normalizeExplainRequest,
  normalizeExplainResponse,
} from '../lib/explain-contract.js';

test('normalizes the canonical explain request and article context aliases', () => {
  assert.deepEqual(
    normalizeExplainRequest({
      article: '  全文上下文  ',
      selectedText: '  用户选句  ',
    }),
    { article: '全文上下文', selectedText: '用户选句', glossary: [] }
  );
  assert.deepEqual(
    normalizeExplainRequest({
      articleContext: '局部文章上下文',
      selectedText: '高亮片段',
    }),
    { article: '局部文章上下文', selectedText: '高亮片段', glossary: [] }
  );
  assert.deepEqual(
    normalizeExplainRequest({
      context: '兼容上下文字段',
      selectedText: '普通选句',
    }),
    { article: '兼容上下文字段', selectedText: '普通选句', glossary: [] }
  );
});

test('rejects explain requests without source context or selected text', () => {
  assert.throws(
    () => normalizeExplainRequest({ selectedText: '选句' }),
    ExplainRequestError
  );
  assert.throws(
    () => normalizeExplainRequest({ article: '文章', selectedText: '  ' }),
    ExplainRequestError
  );
});

test('normalizes valid model output and removes ungrounded term sources', () => {
  const response = normalizeExplainResponse(
    {
      plainExplanation: '  同一请求重复执行也只产生一次效果。  ',
      terms: [
        { source: '幂等性', explanation: '重复执行不会改变最终结果。' },
        { source: '业务请求', explanation: '文章前文中的请求对象。' },
        { source: '虚构术语', explanation: '原文中不存在。' },
        { source: '幂等性', explanation: '重复项。' },
        { source: '', explanation: '缺少来源。' },
      ],
      context: '  这句话解释了接口设计的核心约束。  ',
    },
    {
      article: '业务请求需要满足幂等性，以避免重复支付。',
      selectedText: '请求必须具备幂等性',
    }
  );

  assert.deepEqual(response, {
    plainExplanation: '同一请求重复执行也只产生一次效果。',
    terms: [
      { source: '幂等性', explanation: '重复执行不会改变最终结果。' },
      { source: '业务请求', explanation: '文章前文中的请求对象。' },
    ],
    context: '这句话解释了接口设计的核心约束。',
  });
});

test('rejects structurally incomplete model output with actionable errors', () => {
  const source = { article: '文章', selectedText: '选句' };
  assert.throws(
    () =>
      normalizeExplainResponse(
        { terms: [], context: '上下文作用' },
        source
      ),
    /白话解释/
  );
  assert.throws(
    () =>
      normalizeExplainResponse(
        { plainExplanation: '解释', terms: [], context: '' },
        source
      ),
    /上下文说明/
  );
  assert.throws(
    () =>
      normalizeExplainResponse(
        { plainExplanation: '解释', terms: {}, context: '上下文作用' },
        source
      ),
    ExplainResponseError
  );
});

test('builds a grounded JSON-only explanation prompt', () => {
  const prompt = buildExplainPrompt('全文包含幂等性定义。', '幂等性定义');

  assert.match(prompt, /plainExplanation/);
  assert.match(prompt, /source 必须逐字摘自选句或文章/);
  assert.match(prompt, /<article>\n全文包含幂等性定义。\n<\/article>/);
  assert.match(prompt, /<selectedText>\n幂等性定义\n<\/selectedText>/);
  assert.doesNotMatch(prompt, /userGlossary/);
});

test('injects glossary background into the explanation prompt only when present', () => {
  const glossary = [{ term: '幂等键', aliases: ['idempotency key'], explanation: '同一意图只产生一次有效结果' }];
  const prompt = buildExplainPrompt('全文包含幂等键定义。', '幂等键定义', glossary);

  assert.match(prompt, /5\. <userGlossary> 是用户自维护的术语表/);
  assert.match(prompt, /不要把它们列入 terms 输出/);
  assert.match(prompt, /<userGlossary>\n\[\{"term":"幂等键"/);
});

test('normalizes glossary in explain requests and drops glossary-covered terms from responses', () => {
  const source = normalizeExplainRequest({
    article: '业务请求需要满足幂等性，以避免重复支付。',
    selectedText: '请求必须具备幂等性',
    glossary: [
      { term: 'Idempotency Key', aliases: ['幂等键', ''], explanation: '同一意图只产生一次有效结果' },
      null,
      { term: '幂等键', aliases: [] },
    ],
  });
  assert.deepEqual(source.glossary, [
    { term: 'idempotency key', aliases: ['幂等键'], explanation: '同一意图只产生一次有效结果' },
  ]);

  const response = normalizeExplainResponse(
    {
      plainExplanation: '解释。',
      terms: [
        { source: '幂等键', explanation: '术语表已覆盖，应被丢弃。' },
        { source: 'Idempotency Key', explanation: '别名命中，同样丢弃。' },
        { source: '业务请求', explanation: '文章前文中的请求对象。' },
      ],
      context: '上下文。',
    },
    source
  );
  assert.deepEqual(response.terms, [
    { source: '业务请求', explanation: '文章前文中的请求对象。' },
  ]);
});
