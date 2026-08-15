import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeInboxExplanations,
  mergeInboxGlossary,
  mergeInboxPayload,
  normalizePageUrl,
} from '../lib/inbox-merge.js';

const NOW = 1_786_600_000_000;

const document = {
  id: 'doc-1',
  title: '支付幂等设计',
  content: '# 支付幂等\n\n幂等键用于保证同一笔请求重复提交只生效一次。',
  sourceUrl: 'https://example.com/payment-idempotency',
};

test('normalizePageUrl 去掉 hash 与结尾斜杠，保留查询参数', () => {
  assert.equal(normalizePageUrl('https://example.com/a/#section'), 'https://example.com/a');
  assert.equal(normalizePageUrl('https://example.com/a///'), 'https://example.com/a');
  assert.equal(normalizePageUrl('https://example.com/a?x=1'), 'https://example.com/a?x=1');
  assert.equal(normalizePageUrl('not-a-url'), '');
  assert.equal(normalizePageUrl('ftp://example.com/a'), '');
});

test('mergeInboxGlossary 新术语并入，命中既有主术语或别名时跳过', () => {
  const existing = [{ id: 'g-1', term: '幂等键', aliases: ['idempotency key'], explanation: '既有定义' }];
  const incoming = [
    { term: '幂等键', explanation: '重复定义应跳过' },
    { term: 'Idempotency Key', explanation: '撞既有别名也应跳过' },
    { term: '对账', aliases: ['对账', 'reconcile', 'Reconcile'], explanation: '核对两边账目' },
    { term: '', explanation: '空术语应跳过' },
  ];

  const { entries, added, skipped } = mergeInboxGlossary({ incoming, existing, now: NOW });
  assert.equal(added, 1);
  assert.equal(skipped, 2);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].term, '对账');
  assert.deepEqual(entries[0].aliases, ['reconcile']);
  assert.match(entries[0].id, /^glossary-inbox-/u);
});

test('mergeInboxExplanations 按来源网址挂载解读并定位原文', () => {
  const inboxItems = [{
    // hash 与尾斜杠差异不影响匹配
    url: 'https://example.com/payment-idempotency/#intro',
    title: '支付幂等设计',
    selectedText: '同一笔请求重复提交只生效一次',
    plainExplanation: '这就是幂等的含义。',
    context: '前文。',
    terms: [{ source: '幂等键', explanation: '唯一标识一次业务意图的键' }],
    savedAt: NOW - 60_000,
  }];

  const { records, attached, unmatched } = mergeInboxExplanations({
    inboxItems,
    documents: [document],
    explanations: [],
    now: NOW,
  });
  assert.equal(attached, 1);
  assert.equal(unmatched, 0);
  const record = records[0];
  assert.equal(record.documentId, 'doc-1');
  assert.equal(record.fromInbox, true);
  assert.equal(record.explanation.plainExplanation, '这就是幂等的含义。');
  assert.deepEqual(record.explanation.mappings, [
    { source: '幂等键', target: '唯一标识一次业务意图的键', note: '' },
  ]);
  // 选中文本能在正文中定位，补齐 sourceStart/sourceEnd
  assert.ok(Number.isInteger(record.sourceStart));
  assert.equal(
    document.content.slice(record.sourceStart, record.sourceEnd),
    '同一笔请求重复提交只生效一次'
  );
  assert.equal(record.createdAt, NOW - 60_000);
});

test('mergeInboxExplanations 未匹配网址与重复选区分别计数', () => {
  const inboxItems = [
    { url: 'https://unknown.example.com/x', selectedText: '任意文本', plainExplanation: '解释。' },
    { url: document.sourceUrl, selectedText: '同一笔请求重复提交只生效一次', plainExplanation: '重复解读。' },
    { url: document.sourceUrl, selectedText: '', plainExplanation: '缺选中文本应计未匹配。' },
  ];
  const existingExplanations = [
    { documentId: 'doc-1', selectedText: '同一笔请求重复提交只生效一次' },
  ];

  const { records, attached, unmatched, duplicates } = mergeInboxExplanations({
    inboxItems,
    documents: [document],
    explanations: existingExplanations,
    now: NOW,
  });
  assert.equal(attached, 0);
  assert.equal(unmatched, 2);
  assert.equal(duplicates, 1);
  assert.equal(records.length, 0);
});

test('mergeInboxPayload 汇总术语与解读的合并结果', () => {
  const payload = {
    inboxItems: [{
      url: document.sourceUrl,
      selectedText: '幂等键用于保证',
      plainExplanation: '幂等键的作用。',
      savedAt: NOW - 1_000,
    }],
    glossaryTerms: [{ term: '幂等键', explanation: '既有术语应跳过' }, { term: '新术语', explanation: '新定义' }],
  };
  const merged = mergeInboxPayload(payload, {
    documents: [document],
    glossary: [{ id: 'g-1', term: '幂等键', aliases: [] }],
    explanations: [],
    now: NOW,
  });

  assert.equal(merged.glossaryEntries.length, 1);
  assert.equal(merged.glossaryEntries[0].term, '新术语');
  assert.equal(merged.explanationRecords.length, 1);
  assert.deepEqual(merged.summary, {
    addedTerms: 1,
    skippedTerms: 1,
    attachedExplanations: 1,
    unmatchedItems: 0,
    duplicates: 0,
  });
});

test('mergeInboxPayload 空载荷安全返回空结果', () => {
  const merged = mergeInboxPayload(null, { now: NOW });
  assert.deepEqual(merged.glossaryEntries, []);
  assert.deepEqual(merged.explanationRecords, []);
  assert.deepEqual(merged.summary, {
    addedTerms: 0,
    skippedTerms: 0,
    attachedExplanations: 0,
    unmatchedItems: 0,
    duplicates: 0,
  });
});
