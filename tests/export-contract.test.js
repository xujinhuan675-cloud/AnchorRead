import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnkiText, sanitizeAnkiTag } from '../lib/anki-export.js';
import { buildObsidianNote, buildObsidianVaultNotes } from '../lib/obsidian-export.js';

const cards = [
  { front: '什么是幂等？', back: '重复提交只产生一次有效结果', articleTitle: '支付系统设计' },
  { front: 'FSRS\n是什么', back: '间隔重复\t算法', articleTitle: '' },
  { front: '   ', back: '无效卡片应被过滤' },
];

test('anki export emits anki-compatible headers and tab-separated rows', () => {
  const text = buildAnkiText(cards);
  const lines = text.split('\n');

  assert.equal(lines[0], '#separator:tab');
  assert.equal(lines[1], '#html:true');
  assert.equal(lines[2], '#tags column:3');
  // 无效卡片被过滤，只剩 2 行数据
  assert.equal(lines.length, 3 + 2 + 1);

  const [row1, row2] = lines.slice(3);
  assert.deepEqual(row1.split('\t'), ['什么是幂等？', '重复提交只产生一次有效结果', 'AnchorRead 支付系统设计']);
  // 换行转 <br>、制表符转空格
  assert.match(row2, /^FSRS<br>是什么\t间隔重复 算法\tAnchorRead$/);
});

test('anki tags are sanitized for spaces and special characters', () => {
  assert.equal(sanitizeAnkiTag('支付系统 设计/v2'), '支付系统_设计_v2');
  assert.equal(sanitizeAnkiTag(''), '');
});

const document = { id: 'doc-1', title: '支付系统: 设计', sourceType: 'url', sourceUrl: 'https://example.com/pay' };
const explanations = [
  {
    documentId: 'doc-1',
    selectedText: '幂等键让服务端识别重试。',
    explanation: { plainExplanation: '同一意图只生效一次。' },
  },
];
const terms = [
  { documentId: 'doc-1', term: '幂等', aliases: ['idempotency'], status: 'mastered', explanation: '重复执行结果一致' },
];
const flashcards = [{ documentId: 'doc-1', front: 'Q', back: 'A' }];

test('obsidian note contains frontmatter, quote, wikilink terms and flashcards', () => {
  const note = buildObsidianNote({ document, explanations, terms, flashcards, exportedAt: 1700000000000 });

  assert.equal(note.filename, '支付系统 设计.md');
  assert.match(note.content, /^---\n/);
  assert.match(note.content, /title: "支付系统: 设计"/);
  assert.match(note.content, /source_url: "https:\/\/example\.com\/pay"/);
  assert.match(note.content, /> 幂等键让服务端识别重试。/);
  assert.match(note.content, /同一意图只生效一次。/);
  assert.match(note.content, /\[\[幂等\]\]（别名：idempotency） ✅ 已掌握/);
  assert.match(note.content, /- \*\*问\*\*：Q/);
});

test('vault export groups derived records by document and skips empty docs', () => {
  const notes = buildObsidianVaultNotes({
    documents: [document, { id: 'doc-2', title: '空文档' }],
    explanations,
    terms,
    flashcards,
  });

  assert.equal(notes.length, 1);
  assert.equal(notes[0].filename, '支付系统 设计.md');
});

test('obsidian note requires document id and title', () => {
  assert.throws(() => buildObsidianNote({ document: {} }), /id 与 title/);
});
