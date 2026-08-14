import { createSourceFingerprint } from './provenance.js';

export const MAX_READER_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_READER_DOCUMENT_CHARACTERS = 1_000_000;
export const UNTITLED_READER_DOCUMENT = '未命名文档';

const MIME_TYPES_BY_EXTENSION = Object.freeze({
  '.md': new Set([
    'application/markdown',
    'text/markdown',
    'text/plain',
    'text/x-markdown',
  ]),
  '.txt': new Set(['text/plain']),
});
const CJK_CHARACTER_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

export class ReaderDocumentImportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReaderDocumentImportError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ReaderDocumentImportError(code, message, details);
}

function normalizeTitleCandidate(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim()
    : '';
}

function fileExtension(fileName) {
  const normalizedName = typeof fileName === 'string'
    ? fileName.replaceAll('\\', '/').split('/').pop().trim()
    : '';
  const dotIndex = normalizedName.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return normalizedName.slice(dotIndex).toLowerCase();
}

function titleFromFileName(fileName) {
  const normalizedName = typeof fileName === 'string'
    ? fileName.replaceAll('\\', '/').split('/').pop().trim()
    : '';
  const extension = fileExtension(normalizedName);
  return normalizeTitleCandidate(
    extension ? normalizedName.slice(0, -extension.length) : normalizedName
  );
}

function markdownH1(content) {
  const lines = content.split('\n');
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const atxHeading = line.match(/^\s{0,3}#(?:[\t ]+|$)(.*)$/u);
    if (atxHeading) {
      const title = normalizeTitleCandidate(
        atxHeading[1].replace(/[\t ]+#+[\t ]*$/u, '')
      );
      if (title) return title;
    }

    const setextUnderline = lines[index + 1]?.match(/^\s{0,3}=+[\t ]*$/u);
    const title = normalizeTitleCandidate(line);
    if (title && setextUnderline) return title;
  }

  return '';
}

function defaultRandomId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function normalizeIdToken(value) {
  const token = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return token || 'local';
}

function normalizeExistingIds(existingIds) {
  if (existingIds === undefined) return new Set();
  if (existingIds instanceof Set) return existingIds;
  if (typeof existingIds === 'string' || existingIds === null) {
    throw new TypeError('existingIds must be an iterable of document ids.');
  }
  try {
    return new Set(existingIds);
  } catch {
    throw new TypeError('existingIds must be an iterable of document ids.');
  }
}

function normalizeTimestamp(now) {
  if (!Number.isFinite(now) || now < 0) {
    throw new TypeError('Document timestamp must be a non-negative finite number.');
  }
  return Math.floor(now);
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function formatByteLimit(bytes) {
  const mebibytes = bytes / 1024 / 1024;
  return mebibytes >= 1 && Number.isInteger(mebibytes)
    ? `${mebibytes} MiB`
    : `${bytes.toLocaleString('en-US')} bytes`;
}

export function normalizeReaderDocumentContent(
  value,
  { maxCharacters = MAX_READER_DOCUMENT_CHARACTERS } = {}
) {
  if (typeof value !== 'string') {
    fail(
      'INVALID_DOCUMENT_CONTENT',
      'Document content must be text. Read the file as UTF-8 text and try again.'
    );
  }
  if (!Number.isInteger(maxCharacters) || maxCharacters <= 0) {
    throw new TypeError('maxCharacters must be a positive integer.');
  }

  const withoutBom = value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
  const content = withoutBom.replace(/\r\n?|\u2028|\u2029/gu, '\n');

  if (!content.trim()) {
    fail(
      'EMPTY_DOCUMENT',
      'The document is empty. Add readable text before importing it.'
    );
  }
  if (content.length > maxCharacters) {
    fail(
      'DOCUMENT_TOO_LONG',
      `The document has ${content.length.toLocaleString('en-US')} characters; the limit is ${maxCharacters.toLocaleString('en-US')}. Split it into smaller documents and import them separately.`,
      { actualCharacters: content.length, maxCharacters }
    );
  }

  return content;
}

export function deriveReaderDocumentTitle({ title, content = '', fileName } = {}) {
  return normalizeTitleCandidate(title)
    || markdownH1(typeof content === 'string' ? content : '')
    || titleFromFileName(fileName)
    || UNTITLED_READER_DOCUMENT;
}

export function assertSupportedReaderDocumentFile(
  { name, type = '', size } = {},
  { maxBytes = MAX_READER_DOCUMENT_BYTES } = {}
) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive integer.');
  }

  const extension = fileExtension(name);
  const allowedMimeTypes = MIME_TYPES_BY_EXTENSION[extension];
  if (!allowedMimeTypes) {
    fail(
      'UNSUPPORTED_FILE_EXTENSION',
      'Only .md and .txt files can be imported. Choose one of those formats and try again.',
      { extension }
    );
  }

  const mimeType = typeof type === 'string'
    ? type.split(';', 1)[0].trim().toLowerCase()
    : '';
  if (mimeType && !allowedMimeTypes.has(mimeType)) {
    fail(
      'UNSUPPORTED_FILE_TYPE',
      `The MIME type "${mimeType}" does not match a supported ${extension} text file. Export it as Markdown or plain text and try again.`,
      { extension, mimeType }
    );
  }

  if (Number.isFinite(size) && size > maxBytes) {
    fail(
      'FILE_TOO_LARGE',
      `The file is larger than ${formatByteLimit(maxBytes)}. Split it into smaller .md or .txt files and import them separately.`,
      { actualBytes: size, maxBytes }
    );
  }

  return Object.freeze({
    extension,
    mimeType,
    sourceType: extension === '.md' ? 'markdown' : 'text',
  });
}

export function createReaderDocumentId({
  now = Date.now(),
  randomId = defaultRandomId,
  existingIds = [],
} = {}) {
  if (typeof randomId !== 'function') {
    throw new TypeError('randomId must be a function.');
  }

  const timestamp = normalizeTimestamp(now).toString(36);
  const randomToken = normalizeIdToken(randomId());
  const baseId = `reader-lab-document-${timestamp}-${randomToken}`;
  const usedIds = normalizeExistingIds(existingIds);
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function estimateReaderDocumentReadMinutes(
  content,
  { wordsPerMinute = 220, cjkCharactersPerMinute = 400 } = {}
) {
  if (typeof content !== 'string' || !content.trim()) return 0;
  if (!(wordsPerMinute > 0) || !(cjkCharactersPerMinute > 0)) {
    throw new TypeError('Reading speeds must be positive numbers.');
  }

  const cjkCharacters = content.match(CJK_CHARACTER_PATTERN)?.length || 0;
  const nonCjkContent = content.replace(CJK_CHARACTER_PATTERN, ' ');
  const words = nonCjkContent.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length || 0;
  return Math.max(1, Math.ceil(
    (cjkCharacters / cjkCharactersPerMinute) + (words / wordsPerMinute)
  ));
}

function createReaderDocument({
  content,
  title,
  fileName,
  sourceType,
  importSource,
  now,
  randomId,
  existingIds,
  maxCharacters,
}) {
  const timestamp = normalizeTimestamp(now);
  const normalizedContent = normalizeReaderDocumentContent(content, { maxCharacters });

  return {
    id: createReaderDocumentId({ now: timestamp, randomId, existingIds }),
    title: deriveReaderDocumentTitle({
      title,
      content: sourceType === 'markdown' ? normalizedContent : '',
      fileName,
    }),
    content: normalizedContent,
    contentFingerprint: createSourceFingerprint(normalizedContent),
    sourceType,
    importSource,
    sourceName: fileName || undefined,
    readerLab: true,
    status: 'active',
    category: '导入文档',
    readMinutes: estimateReaderDocumentReadMinutes(normalizedContent),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createReaderDocumentFromPaste(
  { content, title } = {},
  {
    now = Date.now(),
    randomId = defaultRandomId,
    existingIds = [],
    maxCharacters = MAX_READER_DOCUMENT_CHARACTERS,
  } = {}
) {
  return createReaderDocument({
    content,
    title,
    sourceType: 'markdown',
    importSource: 'paste',
    now,
    randomId,
    existingIds,
    maxCharacters,
  });
}

export function createReaderDocumentFromFile(
  { content, name, type = '', size, title } = {},
  {
    now = Date.now(),
    randomId = defaultRandomId,
    existingIds = [],
    maxBytes = MAX_READER_DOCUMENT_BYTES,
    maxCharacters = MAX_READER_DOCUMENT_CHARACTERS,
  } = {}
) {
  const actualSize = typeof content === 'string'
    ? Math.max(Number.isFinite(size) ? size : 0, utf8ByteLength(content))
    : size;
  const file = assertSupportedReaderDocumentFile(
    { name, type, size: actualSize },
    { maxBytes }
  );
  return createReaderDocument({
    content,
    title,
    fileName: name,
    sourceType: file.sourceType,
    importSource: 'file',
    now,
    randomId,
    existingIds,
    maxCharacters,
  });
}
