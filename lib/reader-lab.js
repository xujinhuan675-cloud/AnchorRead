import { SAMPLE_ARTICLES } from './sample-articles.js';

export const READER_LAB_DOCUMENT_IDS = Object.freeze([
  'reader-lab-payment-idempotency',
  'reader-lab-rag-acceptance',
]);

const DOCUMENT_META = Object.freeze([
  {
    author: 'AnchorRead 示例库',
    category: 'API 设计',
    readMinutes: 8,
  },
  {
    author: 'AnchorRead 示例库',
    category: 'AI 工程',
    readMinutes: 7,
  },
]);

function compactText(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

export function createReaderLabSeedDocuments({ now = Date.now() } = {}) {
  return READER_LAB_DOCUMENT_IDS.map((id, index) => ({
    id,
    title: SAMPLE_ARTICLES[index].title,
    content: SAMPLE_ARTICLES[index].content,
    sourceType: 'markdown',
    readerLab: true,
    status: 'active',
    ...DOCUMENT_META[index],
    createdAt: now - (index + 1) * 86_400_000,
    updatedAt: now - index * 3_600_000,
  }));
}

export function recordsForDocument(records, documentId) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => record?.documentId === documentId)
    .sort((left, right) => {
      const leftPosition = left.range?.from ?? left.sourceStart ?? 0;
      const rightPosition = right.range?.from ?? right.sourceStart ?? 0;
      return leftPosition - rightPosition || left.createdAt - right.createdAt;
    });
}

export function findSourceQuoteRange(source, quote, occurrence = 0) {
  if (typeof source !== 'string' || typeof quote !== 'string' || !quote) return null;

  const positions = [];
  let cursor = 0;
  while (cursor <= source.length - quote.length) {
    const found = source.indexOf(quote, cursor);
    if (found === -1) break;
    positions.push(found);
    cursor = found + Math.max(quote.length, 1);
  }

  if (positions.length === 0) return null;
  const index = Math.min(Math.max(occurrence, 0), positions.length - 1);
  return { start: positions[index], end: positions[index] + quote.length };
}

export function createReaderLabExplanation({
  id,
  document,
  selection,
  response,
  isDemo = false,
  now = Date.now(),
}) {
  if (!document?.id || typeof document.content !== 'string') {
    throw new TypeError('A source document is required.');
  }
  if (!selection || !Number.isInteger(selection.from) || !Number.isInteger(selection.to)) {
    throw new TypeError('A ProseMirror text range is required.');
  }

  const selectedText = compactText(selection.text);
  if (!selectedText || selection.from >= selection.to) {
    throw new TypeError('The selected source range must contain text.');
  }

  const sourceRange = findSourceQuoteRange(
    document.content,
    selection.text.trim(),
    selection.occurrence || 0
  );

  return {
    id: id || `reader-lab-explanation-${now}`,
    documentId: document.id,
    selectedText,
    range: { from: selection.from, to: selection.to },
    sourceStart: sourceRange?.start,
    sourceEnd: sourceRange?.end,
    explanation: {
      plainExplanation: compactText(response?.plainExplanation),
      context: compactText(response?.context),
      terms: Array.isArray(response?.terms) ? response.terms : [],
    },
    isDemo: Boolean(isDemo),
    createdAt: now,
    updatedAt: now,
  };
}

export function createReaderLabTerms({
  documentId,
  explanationId,
  selectedText,
  range,
  terms,
  isDemo = false,
  now = Date.now(),
}) {
  const sourceTerms = Array.isArray(terms) && terms.length > 0
    ? terms
    : [{ source: selectedText, explanation: `“${compactText(selectedText)}”是当前选中的待理解术语。` }];
  const seen = new Set();

  return sourceTerms.flatMap((term, index) => {
    const source = compactText(term?.source);
    const normalizedTerm = source.toLocaleLowerCase('zh-CN');
    if (!source || seen.has(normalizedTerm)) return [];
    seen.add(normalizedTerm);
    return [{
      id: `reader-lab-term-${documentId}-${now}-${index}`,
      documentId,
      explanationId: explanationId || '',
      term: source,
      normalizedTerm,
      explanation: compactText(term?.explanation) || '待补充定义',
      range: Number.isInteger(range?.from) && Number.isInteger(range?.to)
        ? { from: range.from, to: range.to }
        : undefined,
      isDemo: Boolean(isDemo),
      createdAt: now,
      updatedAt: now,
    }];
  });
}

export function createDemoExplanation(selectedText) {
  const text = compactText(selectedText);
  let plainExplanation = `这段话强调“${text}”在全文论证中的具体作用。理解时应把它和前后的条件、结果一起看，而不是把它当作孤立结论。`;

  if (/幂等|Idempotency/iu.test(text)) {
    plainExplanation = '这里说的是：同一个业务意图即使被重复提交，也只能产生一次有效结果。幂等键让服务端能够识别“这是同一次操作的重试”。';
  } else if (/PENDING|状态/iu.test(text)) {
    plainExplanation = '这里区分了“仍在处理中”和“已经失败”。PENDING 只说明结果尚未确定，因此客户端应查询或等待，不能立刻创建第二笔请求。';
  } else if (/检索|Faithfulness|Recall|证据/iu.test(text)) {
    plainExplanation = '这里把 RAG 质量拆成两层：先判断证据有没有被找到，再判断回答有没有忠实使用证据。两个问题需要用不同指标定位。';
  } else if (/权限|越权/iu.test(text)) {
    plainExplanation = '这里把权限错误设为阻断项：即使答案内容正确，只要用户本不该看到对应证据，系统也不能上线。';
  }

  const termMatch = text.match(/[A-Za-z][A-Za-z0-9@._-]{2,}|[\u4e00-\u9fff]{2,8}/u);
  const term = termMatch?.[0] || text.slice(0, 12);

  return {
    plainExplanation,
    context: '这是明确标识的本地 Demo 响应，用于验证交互、范围附着和持久化；它没有调用外部模型。',
    terms: term ? [{ source: term, explanation: `选段中的关键概念：${term}` }] : [],
  };
}

export function splitSourceIntoBlocks(source) {
  if (typeof source !== 'string' || !source) return [];
  const blocks = [];
  const lines = source.match(/[^\n]*(?:\n|$)/gu) || [];
  let blockStart = 0;
  let cursor = 0;
  let fenceMarker = '';

  const pushBlock = (end) => {
    const candidate = source.slice(blockStart, end);
    const leadingWhitespace = candidate.match(/^\s*/u)?.[0].length || 0;
    const raw = candidate.trim();
    if (!raw) return;
    const start = blockStart + leadingWhitespace;
    blocks.push({
      id: `source-block-${blocks.length}`,
      source: raw,
      sourceStart: start,
      sourceEnd: start + raw.length,
    });
  };

  for (const line of lines) {
    const lineWithoutNewline = line.replace(/\n$/u, '');
    const fence = lineWithoutNewline.trimStart().match(/^(`{3,}|~{3,})/u)?.[1] || '';
    if (fence && !fenceMarker) {
      fenceMarker = fence[0];
    } else if (fence && fenceMarker && fence[0] === fenceMarker) {
      fenceMarker = '';
    }

    if (!fenceMarker && lineWithoutNewline.trim() === '') {
      pushBlock(cursor);
      blockStart = cursor + line.length;
    }
    cursor += line.length;
  }
  pushBlock(source.length);
  return blocks;
}

export function deriveReaderDraft(document, explanations) {
  const blocks = splitSourceIntoBlocks(document?.content || '').map((block) => ({
    ...block,
    explanations: [],
  }));
  const unplaced = [];

  for (const record of recordsForDocument(explanations, document?.id)) {
    let block = Number.isFinite(record.sourceStart)
      ? blocks.find((candidate) =>
        record.sourceStart >= candidate.sourceStart && record.sourceStart < candidate.sourceEnd
      )
      : null;
    if (!block) {
      block = blocks.find((candidate) => candidate.source.includes(record.selectedText));
    }
    if (block) block.explanations.push(record);
    else unplaced.push(record);
  }

  return { blocks, unplaced };
}

export function createReviewState(record, mastered, { now = Date.now() } = {}) {
  return {
    id: `reader-lab-review-${record.id}`,
    documentId: record.documentId,
    itemId: record.id,
    itemType: 'explanation',
    mastered: Boolean(mastered),
    dueAt: mastered ? now + 30 * 86_400_000 : now,
    createdAt: now,
    updatedAt: now,
  };
}

export function calculateReadingProgress({ scrollTop, scrollHeight, clientHeight }) {
  const available = Math.max(Number(scrollHeight) - Number(clientHeight), 0);
  if (!Number.isFinite(available) || available <= 0) return 100;
  const progress = (Math.max(Number(scrollTop), 0) / available) * 100;
  return Math.min(100, Math.max(0, Math.round(progress)));
}
