import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AskRequestError,
  AskResponseError,
  normalizeAskRequest,
  normalizeAskResponse,
} from '../lib/ask-contract.js';
import { buildAskPrompt } from '../lib/article-prompts.js';

const source = {
  article: '系统设计文档：请求需要携带幂等键，服务端据此识别重试。',
  selectedText: '请求需要携带幂等键',
};

test('normalizeAskRequest 要求文章与选区齐备', () => {
  assert.deepEqual(normalizeAskRequest(source), {
    article: source.article,
    selectedText: source.selectedText,
    glossary: [],
  });
  assert.throws(() => normalizeAskRequest({ ...source, selectedText: '' }), AskRequestError);
  assert.throws(() => normalizeAskRequest({ ...source, article: '  ' }), AskRequestError);
  assert.throws(() => normalizeAskRequest(null), AskRequestError);
});

test('normalizeAskResponse 要求回答存在，候选词条缺失时视为无候选', () => {
  const normalized = normalizeAskResponse({ answer: '幂等键用于识别重试。' }, source);
  assert.equal(normalized.answer, '幂等键用于识别重试。');
  assert.deepEqual(normalized.candidates, []);

  assert.throws(() => normalizeAskResponse({ answer: '   ' }, source), AskResponseError);
  assert.throws(() => normalizeAskResponse(null, source), AskResponseError);
});

test('normalizeAskResponse 丢弃虚构、重复与术语表已收录的候选词条', () => {
  const glossarySource = {
    ...source,
    glossary: [{ term: '重试', aliases: ['retry'], explanation: '重复发起同一请求' }],
  };
  const normalized = normalizeAskResponse({
    answer: '回答',
    candidates: [
      { term: '幂等键', aliases: ['Idempotency Key', '幂等键'], explanation: '识别重复请求的唯一标识' },
      { term: '幂等键', aliases: [], explanation: '重复候选应被丢弃' },
      { term: '服务端虚构词', aliases: [], explanation: '原文中不存在' },
      { term: '重试', aliases: [], explanation: '术语表已收录' },
      { term: '服务端', aliases: ['retry'], explanation: '别名撞术语表同样丢弃' },
      { term: '   ', aliases: [], explanation: '空术语丢弃' },
    ],
  }, glossarySource);

  assert.deepEqual(normalized.candidates, [
    { term: '幂等键', aliases: ['Idempotency Key'], explanation: '识别重复请求的唯一标识' },
  ]);
});

test('normalizeAskResponse 限制候选数量并截断超长定义', () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({
    term: `术语${index}`,
    aliases: [],
    explanation: '定义',
  }));
  const longArticle = { ...source, article: candidates.map((item) => item.term).join('，') };
  const normalized = normalizeAskResponse({ answer: '回答', candidates }, longArticle);
  assert.equal(normalized.candidates.length, 6);

  const truncated = normalizeAskResponse({
    answer: '回答',
    candidates: [{ term: '幂等键', aliases: [], explanation: '长'.repeat(1200) }],
  }, source);
  assert.equal(truncated.candidates[0].explanation.length, 1000);
});

test('buildAskPrompt 注入内置问题、候选词条约束与术语表背景', () => {
  const prompt = buildAskPrompt(source.article, source.selectedText);
  assert.match(prompt, /"answer":"\.\.\."/);
  assert.match(prompt, /内置问题：这段内容说的是什么核心概念或机制/);
  assert.match(prompt, /candidates 必须返回空数组，不要硬凑/);
  assert.match(prompt, /<selectedText>\n请求需要携带幂等键\n<\/selectedText>/);
  assert.doesNotMatch(prompt, /<question>/);
  assert.doesNotMatch(prompt, /userGlossary/);

  const glossary = [{ term: '幂等键', aliases: [], explanation: '识别重复请求的标识' }];
  const withGlossary = buildAskPrompt(source.article, source.selectedText, glossary);
  assert.match(withGlossary, /4\. <userGlossary> 是用户自维护的术语表/);
  assert.match(withGlossary, /表中术语不要列入 candidates/);
});
