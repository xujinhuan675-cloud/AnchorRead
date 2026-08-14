import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_READER_DOCUMENT_BYTES,
  ReaderDocumentImportError,
  assertSupportedReaderDocumentFile,
  createReaderDocumentFromFile,
  createReaderDocumentFromPaste,
  createReaderDocumentId,
  deriveReaderDocumentTitle,
  estimateReaderDocumentReadMinutes,
  normalizeReaderDocumentContent,
} from '../lib/reader-document.js';
import { createSourceFingerprint } from '../lib/provenance.js';
import {
  createMemoryWorkspaceAdapter,
  createWorkspaceRepository,
} from '../lib/local-workspace-db.js';

function assertImportError(callback, code, messagePattern) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof ReaderDocumentImportError);
    assert.equal(error.code, code);
    assert.match(error.message, messagePattern);
    return true;
  });
}

test('normalizes a leading BOM and all common line endings without trimming source text', () => {
  const content = normalizeReaderDocumentContent('\ufeff# Title\r\n\rBody\u2028End\u2029');

  assert.equal(content, '# Title\n\nBody\nEnd\n');
});

test('rejects empty and over-limit content with actionable errors', () => {
  assertImportError(
    () => normalizeReaderDocumentContent(' \n\t '),
    'EMPTY_DOCUMENT',
    /add readable text/iu
  );
  assertImportError(
    () => normalizeReaderDocumentContent('12345', { maxCharacters: 4 }),
    'DOCUMENT_TOO_LONG',
    /split it into smaller documents/iu
  );
});

test('derives title by explicit title, first Markdown H1, file name, then fallback', () => {
  const content = '```md\n# Not a title\n```\n\n# Actual title ###\nBody';

  assert.equal(deriveReaderDocumentTitle({
    title: '  Explicit   title ',
    content,
    fileName: 'notes.md',
  }), 'Explicit title');
  assert.equal(deriveReaderDocumentTitle({ content, fileName: 'notes.md' }), 'Actual title');
  assert.equal(deriveReaderDocumentTitle({ content: 'No heading', fileName: 'reading-notes.txt' }), 'reading-notes');
  assert.equal(deriveReaderDocumentTitle({ content: 'No heading' }), '未命名文档');
});

test('recognizes a Setext H1 as a Markdown title', () => {
  assert.equal(
    deriveReaderDocumentTitle({ content: 'Setext title\n============\n\nBody' }),
    'Setext title'
  );
});

test('accepts supported extension and MIME combinations including missing browser MIME', () => {
  assert.deepEqual(
    assertSupportedReaderDocumentFile({ name: 'Guide.MD', type: 'text/markdown; charset=utf-8' }),
    { extension: '.md', mimeType: 'text/markdown', sourceType: 'markdown' }
  );
  assert.deepEqual(
    assertSupportedReaderDocumentFile({ name: 'notes.txt', type: '' }),
    { extension: '.txt', mimeType: '', sourceType: 'text' }
  );
});

test('rejects unsupported extensions, MIME types, and oversized files', () => {
  assertImportError(
    () => assertSupportedReaderDocumentFile({ name: 'book.pdf', type: 'application/pdf' }),
    'UNSUPPORTED_FILE_EXTENSION',
    /only \.md and \.txt/iu
  );
  assertImportError(
    () => assertSupportedReaderDocumentFile({ name: 'notes.txt', type: 'text/html' }),
    'UNSUPPORTED_FILE_TYPE',
    /export it as Markdown or plain text/iu
  );
  assertImportError(
    () => assertSupportedReaderDocumentFile({
      name: 'large.md',
      type: 'text/markdown',
      size: MAX_READER_DOCUMENT_BYTES + 1,
    }),
    'FILE_TOO_LARGE',
    /split it into smaller \.md or \.txt files/iu
  );
  assertImportError(
    () => createReaderDocumentFromFile(
      { name: 'unicode.txt', type: 'text/plain', content: '阅读' },
      { maxBytes: 5 }
    ),
    'FILE_TOO_LARGE',
    /larger than/iu
  );
});

test('creates stable collision-safe ids with injected clock and randomness', () => {
  const first = createReaderDocumentId({ now: 1_000, randomId: () => 'ABC-123' });
  const second = createReaderDocumentId({
    now: 1_000,
    randomId: () => 'ABC-123',
    existingIds: [first, `${first}-2`],
  });

  assert.equal(first, 'reader-lab-document-rs-abc-123');
  assert.equal(second, 'reader-lab-document-rs-abc-123-3');
  assert.throws(
    () => createReaderDocumentId({ existingIds: null }),
    /existingIds must be an iterable/iu
  );
});

test('estimates reading time for Latin, CJK, and mixed content', () => {
  assert.equal(estimateReaderDocumentReadMinutes('word '.repeat(220)), 1);
  assert.equal(estimateReaderDocumentReadMinutes('阅'.repeat(401)), 2);
  assert.equal(estimateReaderDocumentReadMinutes(`${'word '.repeat(220)}${'阅'.repeat(400)}`), 2);
  assert.equal(estimateReaderDocumentReadMinutes('  '), 0);
});

test('creates a workspace-compatible Reader Lab document from pasted Markdown', () => {
  const document = createReaderDocumentFromPaste(
    { content: '\ufeff# Pasted title\r\n\r\nBody' },
    { now: 1_000, randomId: () => 'paste' }
  );

  assert.deepEqual(document, {
    id: 'reader-lab-document-rs-paste',
    title: 'Pasted title',
    content: '# Pasted title\n\nBody',
    contentFingerprint: createSourceFingerprint('# Pasted title\n\nBody'),
    sourceType: 'markdown',
    importSource: 'paste',
    sourceName: undefined,
    readerLab: true,
    status: 'active',
    category: '导入文档',
    readMinutes: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  });
});

test('creates a workspace-compatible Reader Lab document from a text file', () => {
  const document = createReaderDocumentFromFile(
    {
      content: '# Plain text body',
      name: 'field-notes.txt',
      type: 'text/plain',
      size: 15,
    },
    { now: 2_000, randomId: () => 'file' }
  );

  assert.equal(document.id, 'reader-lab-document-1jk-file');
  assert.equal(document.title, 'field-notes');
  assert.equal(document.sourceType, 'text');
  assert.equal(document.importSource, 'file');
  assert.equal(document.sourceName, 'field-notes.txt');
  assert.equal(document.readerLab, true);
  assert.equal(document.status, 'active');
  assert.equal(document.createdAt, 2_000);
  assert.equal(document.updatedAt, 2_000);
});

test('round-trips an imported document through the existing workspace repository', async () => {
  const repository = createWorkspaceRepository(createMemoryWorkspaceAdapter());
  const imported = createReaderDocumentFromPaste(
    { content: '# Stored document\n\nBody' },
    { now: 3_000, randomId: () => 'stored' }
  );

  await repository.documents.save(imported);
  const restored = await repository.documents.get(imported.id);

  assert.deepEqual(restored, imported);
});
