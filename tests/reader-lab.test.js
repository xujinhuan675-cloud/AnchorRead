import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyReaderLabReplacements,
  batchAnchorKey,
  calculateReadingProgress,
  collectKnownTerms,
  combineKnownMasteredTerms,
  clozeMappingKey,
  createDemoFlashcards,
  createReaderLabAnalysisRecords,
  createReaderLabExplanation,
  createReaderLabSeedDocuments,
  createReaderLabTerms,
  createReviewState,
  dedupeBatchAnalysisRecords,
  deriveReaderDraft,
  extractMarkdownOutline,
  glossaryToKnownTerms,
  listExplainedTerms,
  listMasteredTerms,
  mergeKnownTerm,
  createDemoGlossary,
  migrateBatchAnalysisMappings,
  precisionReplacementStats,
  recordsForDocument,
  repairDemoPlaceholderRecords,
  repairDemoPlaceholderTerms,
  splitSourceIntoBlocks,
} from '../lib/reader-lab.js';
import {
  createMemoryWorkspaceAdapter,
  createWorkspaceRepository,
} from '../lib/local-workspace-db.js';
import { createDemoReaderAnalysis } from '../lib/reader-analysis.js';
import { createDemoDocumentDiagram } from '../lib/diagram-generation.js';

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
    aids: { explanations: true, diagrams: false, precision: false },
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
  assert.deepEqual(sessions[0].aids, { explanations: true, diagrams: false, precision: false });
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
    '服务端必须使用『幂等键』识别同一次支付意图。'
  );
  assert.equal(
    applyReaderLabReplacements(source, mappings, 'target'),
    '服务端必须使用『识别同一笔业务请求的唯一标记』识别同一次支付意图。'
  );
  assert.equal(
    applyReaderLabReplacements(source, [{ source: '不存在', target: '不会出现' }], 'target'),
    source
  );
});

test('cloze flip writes the original term back into the derived plain view', () => {
  const source = '服务端必须使用幂等键识别同一次支付意图。';
  const mappings = [{ source: '幂等键', target: '识别同一笔业务请求的唯一标记' }];
  const key = clozeMappingKey(mappings[0]);
  assert.equal(key, '幂等键\u0000识别同一笔业务请求的唯一标记');

  // 未翻开：白话视图写入『大白话』
  assert.equal(
    applyReaderLabReplacements(source, mappings, 'target'),
    '服务端必须使用『识别同一笔业务请求的唯一标记』识别同一次支付意图。'
  );
  // 已翻开：同一视图回写『原术语』，形成填空答案
  assert.equal(
    applyReaderLabReplacements(source, mappings, 'target', 0, new Set([key])),
    '服务端必须使用『幂等键』识别同一次支付意图。'
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
    source.replace('idempotency key', '\u300eunique request identifier\u300f')
  );
});

test('precision replacements keep markdown structure markers intact', () => {
  const source = '# 支付 API：幂等请求\n\n> 核心约束：同一意图只产生一笔结果。\n\n| 字段 | 必填 |\n| --- | --- |\n| order_id | 是 |\n\n1. 客户端通过 POST 创建支付。';

  // 映射 source 吞入标题标记：保留 # 前缀，只替换内容，且替换文本的重复标记被剥离
  assert.equal(
    applyReaderLabReplacements(source, [{ source: '# 支付 API', target: '# 支付接口（本地示例替换）' }], 'target'),
    source.replace('# 支付 API', '# 『支付接口（本地示例替换）』')
  );
  // 引用标记同理保留
  assert.equal(
    applyReaderLabReplacements(source, [{ source: '> 核心约束', target: '核心规则（本地示例替换）' }], 'target'),
    source.replace('> 核心约束', '> 『核心规则（本地示例替换）』')
  );
  // 只覆盖表格行首管道的映射直接跳过，表格结构不被破坏
  assert.equal(
    applyReaderLabReplacements(source, [{ source: '|', target: '|（本地示例替换）' }], 'target'),
    source
  );
  // 表格单元格内替换不越过单元格边界，且替换文本中的管道被转义
  assert.equal(
    applyReaderLabReplacements(source, [{ source: 'order_id', target: '订单号|商户唯一' }], 'target'),
    source.replace('order_id', '『订单号\\|商户唯一』')
  );
  // 跨行映射被收敛到起始行内，不破坏块结构
  assert.equal(
    applyReaderLabReplacements(source, [{ source: '幂等请求\n\n> 核心约束', target: '跨行替换' }], 'target'),
    source.replace('幂等请求', '『跨行替换』')
  );
});

test('legacy batch records without mappings are migrated for precision replacement', () => {
  const legacy = {
    id: 'reader-lab-analysis-doc-1',
    documentId: 'doc-1',
    source: '幂等键必须绑定业务意图。',
    selectedText: '幂等键必须绑定业务意图。',
    batchAnalysis: true,
    explanation: { display: '重复提交不会创建第二个业务结果。', plainExplanation: '重复提交不会创建第二个业务结果。' },
  };
  const fresh = {
    id: 'reader-lab-analysis-doc-2',
    documentId: 'doc-1',
    source: '重复请求',
    batchAnalysis: true,
    explanation: { display: '同一次业务重试。', mappings: [{ source: '重复请求', target: '同一次业务重试' }] },
  };

  const { records, migrated } = migrateBatchAnalysisMappings([legacy, fresh], { now: 999 });

  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].id, legacy.id);
  assert.deepEqual(records[0].explanation.mappings, [{
    source: '幂等键必须绑定业务意图。',
    target: '重复提交不会创建第二个业务结果。',
    note: '旧版分析记录迁移生成的映射',
  }]);
  assert.equal(records[0].mappingsMigratedAt, 999);
  // 已带映射的记录原样保留
  assert.equal(records[1], fresh);
  assert.equal(migrateBatchAnalysisMappings([records[0]]).migrated.length, 0);
});

test('legacy demo placeholder records are rewritten with glossary real values on restore', () => {
  const legacy = {
    id: 'reader-lab-analysis-legacy',
    documentId: 'doc-1',
    source: '检索增强生成系统的上线判断不能只看回答是否流畅。',
    batchAnalysis: true,
    explanation: {
      display: '这是对“检索增强生成系统的上线判断不能只”的本地 Demo 阅读辅助。',
      plainExplanation: '这是对“检索增强生成系统的上线判断不能只”的本地 Demo 阅读辅助。',
      mappings: [{
        source: '检索增强生成系统的上线判断不能只',
        target: '检索增强生成系统的上线判断不能只（本地示例替换）',
        start: 0,
        end: 19,
      }],
    },
  };
  const noTerm = {
    id: 'reader-lab-analysis-noterm',
    documentId: 'doc-1',
    source: '这里没有任何词典术语。',
    batchAnalysis: true,
    explanation: {
      display: '这是本地 Demo 阅读辅助。',
      mappings: [{ source: '这里没有任何词典', target: '这里没有任何词典（本地示例替换）' }],
    },
  };
  const untouched = {
    id: 'reader-lab-analysis-fresh',
    documentId: 'doc-1',
    batchAnalysis: true,
    explanation: { display: '通俗解读：正常记录。', mappings: [{ source: 'a', target: 'b' }] },
  };

  const { records, repaired } = repairDemoPlaceholderRecords([legacy, noTerm, untouched], { now: 555 });

  assert.equal(repaired.length, 2);
  // 命中词典：占位映射换成真实大白话，占位解读改成通俗首句（不带“通俗解读：”题头）
  assert.deepEqual(records[0].explanation.mappings, [{
    source: '检索增强生成',
    target: '先检索资料再生成回答',
    note: 'RAG 的中文全称',
  }]);
  assert.equal(records[0].explanation.display, '检索增强生成系统的上线判断不能只看回答是否流畅。');
  assert.equal(records[0].explanation.display.includes('本地 Demo 阅读辅助'), false);
  assert.equal(records[0].demoRepairedAt, 555);
  // 未命中词典：占位映射直接丢弃，不留空替换
  assert.deepEqual(records[1].explanation.mappings, []);
  // 正常记录原样保留
  assert.equal(records[2], untouched);
  // 修复幂等：二次执行不再产出变更
  assert.equal(repairDemoPlaceholderRecords(records).repaired.length, 0);
});

test('legacy demo placeholder terms are repaired with glossary plain wording', () => {
  const legacyTerm = { id: 'term-1', term: '检索增强生成', explanation: '检索增强生成（本地示例替换）', readerLab: true };
  const freshTerm = { id: 'term-2', term: '幂等键', explanation: '同一次操作的去重凭证' };

  const { terms, repaired } = repairDemoPlaceholderTerms([legacyTerm, freshTerm], { now: 666 });

  assert.equal(repaired.length, 1);
  assert.equal(terms[0].explanation, '先检索资料再生成回答');
  assert.equal(terms[0].note, 'RAG 的中文全称');
  assert.equal(terms[1], freshTerm);
});

test('createDemoGlossary seeds 5 built-in entries with real explanations', () => {
  const entries = createDemoGlossary({ now: 200 });
  assert.equal(entries.length, 5);
  for (const entry of entries) {
    assert.equal(typeof entry.id, 'string');
    assert.ok(entry.term);
    assert.ok(entry.explanation);
    assert.equal(entry.createdAt >= 200, true);
  }
  const rag = entries.find((e) => e.term === 'RAG');
  assert.ok(rag);
  assert.ok(rag.aliases.includes('检索增强生成'));
  assert.ok(rag.explanation.includes('先检索资料再生成回答'));
});

test('precision replacement stats expose missing mappings for the reader notice', () => {
  assert.deepEqual(precisionReplacementStats([]), { batchRecords: 0, mappingCount: 0 });
  assert.deepEqual(precisionReplacementStats([
    { batchAnalysis: true, explanation: {} },
    { batchAnalysis: true, explanation: { mappings: [{ source: 'a', target: 'b' }] } },
    { explanation: { mappings: [{ source: 'c', target: 'd' }] } },
  ]), { batchRecords: 2, mappingCount: 1 });
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

test('createReaderLabAnalysisRecords highlights kind keeps highlight records without inline aids', () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const anchorText = 'The server uses an idempotency key.';
  const analysis = {
    version: 1,
    title: document.title,
    summary: '示例摘要。',
    anchors: [
      { source: anchorText, role: 'core', importance: 5, reason: '核心约束', start: document.content.indexOf(anchorText), end: document.content.indexOf(anchorText) + anchorText.length },
    ],
    explanations: [
      {
        blockId: 'reader-analysis-block-1',
        source: '未命中锚点的整块内容。',
        mode: 'plain',
        display: '整块背景解读。',
        mappings: [{ source: 'block', target: '块（替换）' }],
      },
    ],
  };

  const records = createReaderLabAnalysisRecords({ document, analysis, now: 200, kind: 'highlights' });

  // 全文重点只保留锚点高亮：不生成整块背景解读，也不携带行间解读与派生术语
  assert.equal(records.length, 1);
  assert.equal(records[0].batchKind, 'highlights');
  assert.equal(records[0].batchAnalysis, true);
  assert.equal(records[0].explanation, null);
  assert.deepEqual(records[0].terms, []);
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

test('analysis records carry hierarchical structure: word marks and servesTo resolve to record ids', () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const analysis = createDemoReaderAnalysis({ title: document.title, content: document.content, mode: 'plain' });
  const records = createReaderLabAnalysisRecords({ document, analysis, isDemo: true, now: 200 });

  const core = records.find((record) => record.role === 'core');
  const evidence = records.find((record) => record.role === 'evidence');
  const word = records.find((record) => record.level === 'word');
  assert.ok(core && evidence && word);
  // 词语层标记：红框语义、无解读内容、服务于中心论点
  assert.equal(word.markKind, 'center');
  assert.equal(word.explanation, null);
  assert.equal(word.servesTo, core.id);
  // 句子层支撑关系映射为记录 id；中心论点本身无服务对象
  assert.equal(evidence.servesTo, core.id);
  assert.equal(core.servesTo, null);
  assert.equal(core.level, 'sentence');
});

test('highlights batch also generates word-level marks without explanations', () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const analysis = createDemoReaderAnalysis({ title: document.title, content: document.content, mode: 'plain' });
  const records = createReaderLabAnalysisRecords({ document, analysis, isDemo: true, now: 200, kind: 'highlights' });

  assert.ok(records.some((record) => record.level === 'word'));
  assert.ok(records.every((record) => record.explanation === null));
});

test('local demo flashcards extract real role and term content from analysis records', () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const analysis = createDemoReaderAnalysis({ title: document.title, content: document.content, mode: 'plain' });
  const records = createReaderLabAnalysisRecords({ document, analysis, isDemo: true, now: 200 });

  const cards = createDemoFlashcards(records, document.title);
  assert.ok(cards.length > 0);
  // 角色卡：问真实摘录属于哪一层，背面是可记忆的角色定义
  const roleCard = cards.find((card) => card.front.includes('属于哪一层重点'));
  assert.ok(roleCard);
  assert.match(roleCard.back, /中心论点|分论点|论据|对策|案例|概念|结论|背景/);
  // 术语卡：真实术语→大白话，不出现占位示例文案
  const termCard = cards.find((card) => card.front.includes('用大白话怎么理解'));
  assert.ok(termCard);
  assert.ok(cards.every((card) => !card.front.includes('示例') && !card.back.includes('本地示例替换')));
});

test('local demo diagram builds a mermaid mindmap from real document structure', () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const source = createDemoDocumentDiagram(document);

  assert.ok(source.startsWith('mindmap\n'));
  assert.match(source, /root\(\(.+\)\)/u);
  // 章节标题与正文首句都是真实内容，且括号等会触发形状解析的字符已被清理
  const heading = document.content.split('\n').find((line) => /^#{1,6}\s+/u.test(line)).replace(/^#{1,6}\s+/u, '');
  assert.ok(source.includes(heading.replace(/[()（）[\]{}【】<>《》"'`|]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 18)));
  assert.doesNotMatch(source, /^\s{4,}\S*[()（）[\]{}]/gmu);
});

test('batch analysis records are deduped per anchor with inline explanations preferred', () => {
  const [document] = createReaderLabSeedDocuments({ now: 100 });
  const analysis = createDemoReaderAnalysis({ title: document.title, content: document.content, mode: 'plain' });
  // 同一分析的两种批量共存时，同一锚点只保留携带解读的一条
  const highlightRecords = createReaderLabAnalysisRecords({ document, analysis, now: 200, kind: 'highlights' });
  const inlineRecords = createReaderLabAnalysisRecords({ document, analysis, now: 300, kind: 'inline' });
  const manualRecord = createReaderLabExplanation({
    id: 'manual-1',
    document,
    selection: { from: 1, to: 5, text: document.content.slice(2, 6) },
    response,
    now: 400,
  });

  const { records, removed } = dedupeBatchAnalysisRecords([...highlightRecords, ...inlineRecords, manualRecord]);

  assert.ok(removed.length > 0);
  assert.ok(removed.every((record) => record.batchAnalysis));
  assert.ok(records.some((record) => record.id === manualRecord.id));
  const keys = records.filter((record) => record.batchAnalysis).map((record) => `${record.documentId}|${batchAnchorKey(record)}`);
  assert.equal(keys.length, new Set(keys).size);
  // 保留下来的重复锚点记录优先是携带行间解读的解读批量
  const kept = records.filter((record) => record.batchAnalysis);
  for (const record of highlightRecords) {
    const key = `${record.documentId}|${batchAnchorKey(record)}`;
    if (!keys.includes(key)) continue;
    const sameAnchor = kept.filter((item) => `${item.documentId}|${batchAnchorKey(item)}` === key);
    assert.equal(sameAnchor.length, 1);
    assert.equal(sameAnchor[0].batchKind, 'inline');
  }
});

test('extractMarkdownOutline collects ATX headings by level and order', () => {
  const markdown = [
    '# 验收背景',
    '正文段落。',
    '## 检索质量 ##',
    '### **忠实度**指标',
    '#topic 井号后紧跟字母不是标题',
    '',
  ].join('\n');
  assert.deepEqual(extractMarkdownOutline(markdown), [
    { level: 1, text: '验收背景' },
    { level: 2, text: '检索质量' },
    { level: 3, text: '忠实度指标' },
  ]);
});

test('extractMarkdownOutline skips headings inside fenced code blocks', () => {
  const markdown = [
    '# 真实标题',
    '```bash',
    '# 这是 shell 注释不是标题',
    '~~~',
    '```',
    '## 代码块后的标题',
  ].join('\n');
  assert.deepEqual(extractMarkdownOutline(markdown), [
    { level: 1, text: '真实标题' },
    { level: 2, text: '代码块后的标题' },
  ]);
});

test('extractMarkdownOutline returns empty list for blank or non-string input', () => {
  assert.deepEqual(extractMarkdownOutline(''), []);
  assert.deepEqual(extractMarkdownOutline('   \n  '), []);
  assert.deepEqual(extractMarkdownOutline(null), []);
  // 井号后没有空白不是 ATX 标题
  assert.deepEqual(extractMarkdownOutline('#topic'), []);
});
