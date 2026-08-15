import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyReaderLabReplacements,
  calculateReadingProgress,
  collectKnownTerms,
  combineKnownMasteredTerms,
  createReaderLabAnalysisRecords,
  createReaderLabExplanation,
  createReaderLabSeedDocuments,
  createReaderLabTerms,
  createReviewState,
  deriveReaderDraft,
  glossaryToKnownTerms,
  listExplainedTerms,
  listMasteredTerms,
  mergeKnownTerm,
  recordsForDocument,
  splitSourceIntoBlocks,
} from '../lib/reader-lab.js';
import {
  createMemoryWorkspaceAdapter,
  createWorkspaceRepository,
} from '../lib/local-workspace-db.js';

const response = {
  plainExplanation: '这是派生解释。',
  context: '用于测试。',
  terms: [],
};

test('creating and deleting an explanation never mutates the source document', async () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const originalContent = document.content;
  const repository = createWorkspaceRepository(createMemoryWorkspaceAdapter(), { now: 200 });
  await repository.documents.save(document);

  const explanation = createReaderLabExplanation({
    id: 'explanation-1',
    document,
    selection: { from: 1, to: 5, text: '支付 API' },
    response,
    now: 200,
  });
  await repository.explanations.save(explanation);
  await repository.explanations.remove(explanation.id);

  assert.equal(document.content, originalContent);
  assert.equal((await repository.documents.get(document.id)).content, originalContent);
});

test('records remain isolated by document id', () => {
  const [first, second] = createReaderLabSeedDocuments({ now: 100 });
  const records = [
    createReaderLabExplanation({
      id: 'first-record',
      document: first,
      selection: { from: 1, to: 4, text: '支付' },
      response,
      now: 200,
    }),
    createReaderLabExplanation({
      id: 'second-record',
      document: second,
      selection: { from: 1, to: 4, text: '企业' },
      response,
      now: 201,
    }),
  ];

  assert.deepEqual(recordsForDocument(records, first.id).map((item) => item.id), ['first-record']);
  assert.deepEqual(recordsForDocument(records, second.id).map((item) => item.id), ['second-record']);
});

test('local repository restores current session and mastered state', async () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const adapter = createMemoryWorkspaceAdapter();
  const repository = createWorkspaceRepository(adapter, { now: 300 });
  const explanation = createReaderLabExplanation({
    id: 'persisted-explanation',
    document,
    selection: { from: 1, to: 4, text: '支付' },
    response,
    now: 200,
  });

  await repository.documents.save(document);
  await repository.explanations.save(explanation);
  await repository.readSessions.save({
    id: `reader-lab-session-${document.id}`,
    documentId: document.id,
    readerLab: true,
    mode: 'comparison',
    progress: 46,
    updatedAt: 310,
  });
  await repository.reviewStates.save(createReviewState(explanation, true, { now: 320 }));

  const restoredRepository = createWorkspaceRepository(adapter, { now: 400 });
  const sessions = await restoredRepository.readSessions.list({
    index: 'updatedAt',
    direction: 'prev',
  });
  const mastery = await restoredRepository.reviewStates.get('reader-lab-review-persisted-explanation');

  assert.equal(sessions[0].documentId, document.id);
  assert.equal(sessions[0].mode, 'comparison');
  assert.equal(mastery.mastered, true);
});

test('interpretation draft is derived from source blocks without changing source', () => {
  const document = {
    id: 'document-1',
    content: '# 标题\n\n第一段包含关键概念。\n\n第二段保持原样。',
  };
  const original = document.content;
  const explanation = createReaderLabExplanation({
    id: 'explanation-1',
    document,
    selection: { from: 5, to: 9, text: '关键概念' },
    response,
    now: 10,
  });

  const draft = deriveReaderDraft(document, [explanation]);

  assert.equal(document.content, original);
  assert.equal(draft.blocks.length, 3);
  assert.equal(draft.blocks[1].source, '第一段包含关键概念。');
  assert.equal(draft.blocks[1].explanations[0].id, explanation.id);
});

test('reading progress stays bounded', () => {
  assert.equal(calculateReadingProgress({ scrollTop: 250, scrollHeight: 1000, clientHeight: 500 }), 50);
  assert.equal(calculateReadingProgress({ scrollTop: 0, scrollHeight: 400, clientHeight: 500 }), 100);
  assert.equal(calculateReadingProgress({ scrollTop: 2000, scrollHeight: 1000, clientHeight: 500 }), 100);
});

test('term records keep the exact source range for navigation', () => {
  const [term] = createReaderLabTerms({
    documentId: 'document-1',
    selectedText: '幂等性',
    range: { from: 12, to: 15 },
    terms: [{ source: '幂等性', explanation: '重复执行仍保持同一结果。' }],
    now: 20,
  });

  assert.deepEqual(term.range, { from: 12, to: 15 });
});

test('derived source blocks preserve fenced code with internal blank lines', () => {
  const source = '# 请求\n\n```http\nPOST /payments\n\n{ "amount": 100 }\n```\n\n结论。';
  const blocks = splitSourceIntoBlocks(source);

  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].source, '```http\nPOST /payments\n\n{ "amount": 100 }\n```');
});

test('batch analysis records remain grounded and preserve display plus mappings', () => {
  const document = {
    id: 'document-1',
    content: '# 标题\n\n幂等键必须绑定业务意图。重复请求只产生一次结果。',
  };
  const source = '重复请求只产生一次结果';
  const start = document.content.indexOf(source);
  const [record] = createReaderLabAnalysisRecords({
    document,
    analysis: {
      version: 1,
      summary: '重试必须复用原结果。',
      anchors: [{ source, start, end: start + source.length, role: 'conclusion', importance: 5, reason: '关键结论' }],
      explanations: [{
        blockId: 'reader-analysis-block-1',
        mode: 'plain',
        display: '重复提交不会创建第二个业务结果。',
        mappings: [{ source: '重复请求', target: '同一次业务重试', note: '复用原结果' }],
      }],
    },
    now: 50,
  });

  assert.equal(record.selectedText, source);
  assert.equal(document.content.slice(record.sourceStart, record.sourceEnd), source);
  assert.equal(record.explanation.display, '重复提交不会创建第二个业务结果。');
  assert.equal(record.explanation.mappings[0].source, '重复请求');
  assert.equal(record.terms[0].term, '重复请求');
  assert.equal(record.terms[0].explanation, '同一次业务重试');
  assert.equal(record.batchAnalysis, true);
});

test('local replacements bracket only mapped source or target text', () => {
  const source = '服务端必须使用幂等键识别同一次支付意图。';
  const mappings = [{ source: '幂等键', target: '识别同一笔业务请求的唯一标记' }];

  assert.equal(
    applyReaderLabReplacements(source, mappings, 'source'),
    '服务端必须使用⌜幂等键⌝识别同一次支付意图。'
  );
  assert.equal(
    applyReaderLabReplacements(source, mappings, 'target'),
    '服务端必须使用⌜识别同一笔业务请求的唯一标记⌝识别同一次支付意图。'
  );
  assert.equal(
    applyReaderLabReplacements(source, [{ source: '不存在', target: '不会出现' }], 'target'),
    source
  );
});

test('precision replacements preserve all unmapped whitespace and source characters', () => {
  const source = '  Heading\n\n\nThe server uses an idempotency key.\n';
  const mappings = [{
    source: 'idempotency key',
    target: 'unique request identifier',
    start: source.indexOf('idempotency key'),
  }];

  assert.equal(
    applyReaderLabReplacements(source, mappings, 'target'),
    source.replace('idempotency key', '\u231cunique request identifier\u231d')
  );
});

test('createReaderLabTerms normalizes aliases and defaults status to learning', () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const terms = createReaderLabTerms({
    documentId: document.id,
    selectedText: 'idempotency key',
    content: document.content,
    terms: [
      { source: 'Idempotency Key', explanation: '幂等键', aliases: ['Idempotency Key', '', '幂等键'] },
    ],
    now: 100,
  });

  assert.equal(terms.length, 1);
  assert.equal(terms[0].term, 'Idempotency Key');
  assert.equal(terms[0].normalizedTerm, 'idempotency key');
  assert.deepEqual(terms[0].aliases, ['幂等键']);
  assert.equal(terms[0].status, 'learning');
  assert.ok(terms[0].sourceFingerprint);
});

test('createReaderLabAnalysisRecords writes aliases and skips mastered terms', () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const analysis = {
    version: 1,
    title: document.title,
    summary: '示例摘要。',
    anchors: [
      { source: 'The server uses an idempotency key.', role: 'core', importance: 5, reason: '核心约束', start: document.content.indexOf('The server uses an idempotency key.'), end: document.content.indexOf('The server uses an idempotency key.') + 'The server uses an idempotency key.'.length },
    ],
    explanations: [
      {
        blockId: 'reader-analysis-block-0',
        source: 'The server uses an idempotency key.',
        sourceStart: document.content.indexOf('The server uses an idempotency key.'),
        sourceEnd: document.content.indexOf('The server uses an idempotency key.') + 'The server uses an idempotency key.'.length,
        mode: 'plain',
        display: '服务端用幂等键识别同一次请求。',
        mappings: [
          { source: 'idempotency key', target: '幂等键', aliases: ['Idempotency Key', '幂等键'], start: document.content.indexOf('idempotency key'), end: document.content.indexOf('idempotency key') + 'idempotency key'.length },
          { source: 'server', target: '服务端', start: document.content.indexOf('server'), end: document.content.indexOf('server') + 'server'.length },
        ],
      },
    ],
  };

  const records = createReaderLabAnalysisRecords({
    document,
    analysis,
    now: 200,
    knownMasteredTerms: [{ term: 'idempotency key', aliases: ['幂等键'] }],
  });

  const terms = records.flatMap((record) => record.terms);
  assert.ok(terms.every((term) => term.normalizedTerm !== 'idempotency key'));
  const serverTerm = terms.find((term) => term.normalizedTerm === 'server');
  assert.ok(serverTerm, '应保留未掌握术语');
  assert.deepEqual(serverTerm.aliases, []);
  assert.equal(serverTerm.status, 'learning');
  assert.ok(serverTerm.sourceFingerprint);
});

test('collectKnownTerms prefers mastered and accumulates aliases; listMasteredTerms filters mastered', () => {
  const terms = [
    { documentId: 'doc-a', term: 'RAG', normalizedTerm: 'rag', aliases: ['retrieval'], status: 'learning' },
    { documentId: 'doc-b', term: 'RAG', normalizedTerm: 'rag', aliases: ['检索增强'], status: 'mastered' },
    { documentId: 'doc-c', term: 'Faithfulness', normalizedTerm: 'faithfulness', aliases: ['忠实度'], status: 'learning' },
  ];

  const known = collectKnownTerms(terms);
  assert.equal(known.get('rag').status, 'mastered');
  assert.deepEqual(known.get('rag').aliases, ['retrieval', '检索增强']);
  assert.equal(known.get('faithfulness').status, 'learning');

  const mastered = listMasteredTerms(terms, { excludeDocumentId: 'doc-b' });
  assert.deepEqual(mastered, []);
  assert.equal(listMasteredTerms(terms).length, 1);
});

test('mergeKnownTerm accumulates aliases and preserves mastered status', () => {
  const existing = { id: 't1', term: '幂等键', normalizedTerm: '幂等键', aliases: ['idempotency'], status: 'mastered', explanation: '旧定义' };
  const incoming = { id: 't2', term: '幂等键', normalizedTerm: '幂等键', aliases: ['Idempotency Key', '幂等键'], status: 'learning', explanation: '新定义', updatedAt: 300 };

  const merged = mergeKnownTerm(existing, incoming);
  assert.equal(merged.status, 'mastered');
  assert.equal(merged.explanation, '旧定义');
  assert.deepEqual(merged.aliases, ['idempotency', 'idempotency key']);
  assert.equal(merged.updatedAt, 300);
});

test('listExplainedTerms returns learning terms and excludes mastered', () => {
  const terms = [
    { documentId: 'doc-a', term: 'RAG', normalizedTerm: 'rag', aliases: ['retrieval'], status: 'learning' },
    { documentId: 'doc-b', term: '幂等键', normalizedTerm: '幂等键', aliases: ['idempotency'], status: 'mastered' },
    { documentId: 'doc-c', term: 'Faithfulness', normalizedTerm: 'faithfulness', aliases: ['忠实度'], status: 'learning' },
  ];

  const explained = listExplainedTerms(terms);
  assert.equal(explained.length, 2);
  assert.deepEqual(
    explained.find((entry) => entry.term === 'RAG'),
    { term: 'RAG', aliases: ['retrieval'] }
  );
  assert.equal(explained.find((entry) => entry.term === '幂等键'), undefined);
  // 排除当前文档：doc-a 的 RAG 被排除，仅剩 Faithfulness
  assert.equal(listExplainedTerms(terms, { excludeDocumentId: 'doc-a' }).length, 1);
});

test('glossaryToKnownTerms normalizes entries and ignores malformed input', () => {
  const entries = [
    { term: '  幂等键  ', aliases: ['Idempotency Key', '幂等键', ''], explanation: '同一意图只产生一次有效结果' },
    { term: 'RAG', aliases: null },
    null,
    { aliases: ['无主术语'] },
    { term: '幂等键', aliases: [] },
  ];

  const known = glossaryToKnownTerms(entries);
  // 主术语 trim、重复去重；别名小写去重并剔除与主术语重复项
  assert.deepEqual(known, [
    { term: '幂等键', aliases: ['idempotency key'] },
    { term: 'RAG', aliases: [] },
  ]);
  assert.deepEqual(glossaryToKnownTerms(undefined), []);
});

test('combineKnownMasteredTerms merges glossary into mastered terms and dedupes', () => {
  const mastered = [{ term: '幂等键', aliases: ['idempotency key'] }];
  const glossary = [
    { term: '幂等键', aliases: ['幂等性键'], explanation: '同一意图只产生一次有效结果' },
    { term: 'RAG', aliases: ['检索增强'], explanation: '检索增强生成' },
  ];

  const combined = combineKnownMasteredTerms(mastered, glossary);
  // 已掌握优先保留；术语表新增条目追加，均视为已懂
  assert.equal(combined.length, 2);
  assert.deepEqual(combined[0], { term: '幂等键', aliases: ['idempotency key'] });
  assert.deepEqual(combined[1], { term: 'RAG', aliases: ['检索增强'] });
  // 空输入安全
  assert.deepEqual(combineKnownMasteredTerms([], []), []);
});

test('createReaderLabAnalysisRecords skips glossary-covered terms like mastered ones', () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const glossary = [{ term: '幂等键', aliases: ['idempotency key'], explanation: '同一意图只产生一次有效结果' }];
  const combined = combineKnownMasteredTerms([], glossary);

  const records = createReaderLabAnalysisRecords({
    document,
    now: 200,
    knownMasteredTerms: combined,
    analysis: {
      version: 1,
      summary: '示例摘要。',
      anchors: [
        { source: document.content.slice(0, 6), role: 'core', importance: 5, reason: '关键约束' },
      ],
      explanations: [],
    },
  });

  assert.ok(records.length > 0);
});
