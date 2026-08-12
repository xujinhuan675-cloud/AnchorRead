import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateReadingProgress,
  createReaderLabExplanation,
  createReaderLabSeedDocuments,
  createReaderLabTerms,
  createReviewState,
  deriveReaderDraft,
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
