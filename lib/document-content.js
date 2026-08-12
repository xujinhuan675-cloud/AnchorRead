import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

export const DOCUMENT_HIGHLIGHT_LEVELS = Object.freeze([
  'core',
  'concept',
  'evidence',
  'conclusion',
]);

const LEVEL_SET = new Set(DOCUMENT_HIGHLIGHT_LEVELS);
const BLOCK_TEXT_NODES = new Set([
  'root',
  'blockquote',
  'list',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
]);

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Convert user-provided Markdown to sanitized HTML before it reaches Tiptap.
 * Raw HTML in the Markdown is deliberately not passed through by remark-rehype.
 */
export function markdownToSafeHtml(markdown) {
  const source = typeof markdown === 'string' ? markdown : '';
  if (!source.trim()) return '<p></p>';

  try {
    const result = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { allowDangerousHtml: false })
      .use(rehypeSanitize)
      .use(rehypeStringify)
      .processSync(source);

    return String(result) || '<p></p>';
  } catch {
    return `<pre><code>${escapeHtml(source)}</code></pre>`;
  }
}

function markdownNodeToText(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.value === 'string') return node.value;
  if (node.type === 'image' && typeof node.alt === 'string') return node.alt;
  if (!Array.isArray(node.children)) return '';

  const separator = BLOCK_TEXT_NODES.has(node.type) ? '\n' : '';
  return node.children
    .map(markdownNodeToText)
    .filter(Boolean)
    .join(separator);
}

/**
 * Convert a verbatim Markdown fragment returned by the model to the visible
 * text Tiptap renders. This keeps inline code, emphasis, links and table cells
 * matchable after their Markdown delimiters have been removed by the parser.
 */
export function markdownFragmentToText(fragment) {
  const source = typeof fragment === 'string' ? fragment : '';
  if (!source.trim()) return '';

  try {
    return markdownNodeToText(markdownParser.parse(source))
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  } catch {
    return source.trim();
  }
}

function compactWhitespace(value) {
  return value.replace(/\s+/gu, '');
}

function findAllOccurrences(haystack, needle) {
  if (!needle) return [];

  const offsets = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) break;
    offsets.push(found);
    cursor = found + Math.max(needle.length, 1);
  }
  return offsets;
}

function sourceOccurrenceForOffset(source, text, start) {
  if (!Number.isInteger(start) || start < 0) return null;

  const exactOffsets = findAllOccurrences(source, text);
  if (exactOffsets.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    exactOffsets.forEach((offset, index) => {
      const distance = Math.abs(offset - start);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  const compactSource = compactWhitespace(source);
  const compactText = compactWhitespace(text);
  if (!compactText) return null;

  const compactOffsets = findAllOccurrences(compactSource, compactText);
  if (compactOffsets.length === 0) return null;

  const compactPrefixLength = compactWhitespace(source.slice(0, start)).length;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  compactOffsets.forEach((offset, index) => {
    const distance = Math.abs(offset - compactPrefixLength);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/**
 * Normalize API highlights without mutating the objects supplied by callers.
 * preferredOccurrence preserves repeated source fragments after Markdown markup
 * has been removed by the document parser.
 */
export function prepareDocumentHighlights(source, highlights) {
  if (!Array.isArray(highlights)) return [];

  const sourceText = typeof source === 'string' ? source : '';
  const nextOccurrenceByText = new Map();

  return highlights.flatMap((item, sourceIndex) => {
    if (!item || typeof item !== 'object') return [];

    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) return [];

    const occurrenceKey = compactWhitespace(text);
    const sequentialOccurrence = nextOccurrenceByText.get(occurrenceKey) || 0;
    const offsetOccurrence = sourceOccurrenceForOffset(sourceText, text, item.start);
    const preferredOccurrence = offsetOccurrence ?? sequentialOccurrence;

    nextOccurrenceByText.set(
      occurrenceKey,
      Math.max(sequentialOccurrence + 1, preferredOccurrence + 1)
    );

    return [{
      item,
      sourceIndex,
      text,
      documentText: markdownFragmentToText(text) || text,
      level: LEVEL_SET.has(item.level) ? item.level : 'core',
      reason: typeof item.reason === 'string' ? item.reason.trim() : '',
      preferredOccurrence,
    }];
  });
}
