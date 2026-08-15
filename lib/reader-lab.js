import { SAMPLE_ARTICLES } from './sample-articles.js';
import { createSourceFingerprint } from './provenance.js';

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

// 行首 Markdown 结构标记：标题、引用、列表、有序列表
const MARKDOWN_LINE_PREFIX_PATTERN = /^(?:#{1,6}\s+|>\s?|[-+*]\s+|\d{1,9}[.)]\s+)/u;

/** 剥离文本行首的 Markdown 结构标记（含表格行首管道），用于替换文本防重复 */
function stripLeadingMarkdownSyntax(text) {
  return typeof text === 'string'
    ? text.replace(/^\s*(?:#{1,6}\s+|>\s?|[-+*]\s+|\d{1,9}[.)]\s+|\|\s*)+/u, '').trim()
    : '';
}

export function createReaderLabSeedDocuments({ now = Date.now() } = {}) {
  return READER_LAB_DOCUMENT_IDS.map((id, index) => ({
    id,
    title: SAMPLE_ARTICLES[index].title,
    content: SAMPLE_ARTICLES[index].content,
    contentFingerprint: createSourceFingerprint(SAMPLE_ARTICLES[index].content),
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

/** Apply grounded mappings while keeping every unmapped source character intact. */
export function applyReaderLabReplacements(source, mappings, view = 'source', sourceStart = 0) {
  if (typeof source !== 'string' || !source) return source || '';
  const replacements = (Array.isArray(mappings) ? mappings : [])
    .map((mapping, index) => {
      const located = Number.isInteger(mapping?.start)
        ? { start: mapping.start - sourceStart }
        : findSourceQuoteRange(source, mapping?.source, mapping?.occurrence || 0);
      const from = located?.start;
      const text = view === 'target' ? mapping?.target : mapping?.source;
      const length = typeof mapping?.source === 'string' ? mapping.source.length : 0;
      if (!Number.isInteger(from) || from < 0 || !length || from + length > source.length) return null;
      if (typeof text !== 'string' || !text.trim()) return null;
      return protectMarkdownStructure(source, { from, to: from + length, text: text.trim(), index });
    })
    .filter(Boolean)
    .sort((left, right) => left.from - right.from || right.to - left.to || left.index - right.index);

  const accepted = [];
  let cursor = 0;
  for (const replacement of replacements) {
    if (replacement.from < cursor) continue;
    accepted.push(replacement);
    cursor = replacement.to;
  }
  if (accepted.length === 0) return source;

  const chunks = [];
  let position = 0;
  for (const replacement of accepted) {
    chunks.push(source.slice(position, replacement.from));
    chunks.push(`⌜${replacement.text}⌝`);
    position = replacement.to;
  }
  chunks.push(source.slice(position));
  return chunks.join('');
}

/**
 * Markdown 结构保护：替换范围不得吞掉标题/引用/列表/表格行首标记，
 * 不得跨行破坏块结构；替换文本自身携带的行首标记也要剥离，避免标记重复。
 * 调整后若没有可替换内容则返回 null，调用方跳过该映射。
 */
function protectMarkdownStructure(source, replacement) {
  const lineStart = source.lastIndexOf('\n', Math.max(replacement.from - 1, 0)) + 1;
  const lineEndIndex = source.indexOf('\n', lineStart);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  const line = source.slice(lineStart, lineEnd);

  let { from, to, text } = replacement;
  if (/^\s*\|/u.test(line)) {
    // 表格行：保留行首管道，且替换不得越过当前单元格边界
    const leadEnd = lineStart + (line.match(/^\s*\|\s*/u)?.[0].length || 0);
    if (from < leadEnd) from = leadEnd;
    const cellEnd = source.indexOf('|', from);
    if (cellEnd !== -1 && cellEnd < to) to = cellEnd;
    text = text.replace(/\|/gu, '\\|');
  } else {
    const prefixEnd = lineStart + (line.match(MARKDOWN_LINE_PREFIX_PATTERN)?.[0].length || 0);
    if (from < prefixEnd) from = prefixEnd;
  }
  if (to > lineEnd) to = lineEnd;
  text = stripLeadingMarkdownSyntax(text);
  if (from >= to || !text) return null;
  return { ...replacement, from, to, text };
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
    sourceFingerprint: createSourceFingerprint(document.content),
    selectedText,
    range: { from: selection.from, to: selection.to },
    sourceStart: sourceRange?.start,
    sourceEnd: sourceRange?.end,
    explanation: {
      plainExplanation: compactText(response?.plainExplanation),
      context: compactText(response?.context),
      terms: Array.isArray(response?.terms) ? response.terms : [],
      mappings: Array.isArray(response?.terms)
        ? response.terms.flatMap((term) => {
          const source = compactText(term?.source);
          const target = compactText(term?.explanation);
          return source && target ? [{ source, target, note: '' }] : [];
        })
        : [],
    },
    isDemo: Boolean(isDemo),
    createdAt: now,
    updatedAt: now,
  };
}

export function createReaderLabAnalysisRecords({
  document,
  analysis,
  isDemo = false,
  now = Date.now(),
  knownMasteredTerms = [],
  // 重点批量（highlights）只生成高亮记录；解读批量（inline，默认）额外携带行间解读与术语
  kind = 'inline',
}) {
  if (!document?.id || typeof document.content !== 'string') {
    throw new TypeError('A source document is required.');
  }
  if (!analysis || !Array.isArray(analysis.anchors) || !Array.isArray(analysis.explanations)) {
    throw new TypeError('A normalized reader analysis is required.');
  }
  const includeInline = kind !== 'highlights';

  const sourceFingerprint = createSourceFingerprint(document.content);
  // 已掌握术语集合（主术语 + 别名），命中即跳过该术语的解读生成
  const masteredSet = new Set(
    (Array.isArray(knownMasteredTerms) ? knownMasteredTerms : [])
      .flatMap((entry) => {
        const term = typeof entry?.term === 'string' ? entry.term.trim().toLowerCase() : '';
        const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
        return [term, ...aliases.map((alias) => (typeof alias === 'string' ? alias.trim().toLowerCase() : ''))];
      })
      .filter(Boolean)
  );

  const explanationsByBlock = new Map(
    analysis.explanations.map((explanation) => [explanation.blockId, explanation])
  );
  const blocks = splitSourceIntoBlocks(document.content);
  const blockIds = new Map(blocks.map((block, index) => [block, `reader-analysis-block-${index}`]));
  const usedExplanationBlocks = new Set();

  const records = analysis.anchors.flatMap((anchor, index) => {
    const selectedText = typeof anchor.source === 'string' ? anchor.source : '';
    const sourceStart = Number.isInteger(anchor.start)
      ? anchor.start
      : findSourceQuoteRange(document.content, selectedText)?.start;
    if (!selectedText || !Number.isInteger(sourceStart)) return [];

    const block = blocks.find((candidate) =>
      sourceStart >= candidate.sourceStart && sourceStart < candidate.sourceEnd
    );
    const blockId = blockIds.get(block);
    const isWord = anchor.level === 'word';
    // 词语层标记只画框线，不消耗行间解读块
    const assistant = includeInline && !isWord && blockId && !usedExplanationBlocks.has(blockId)
      ? explanationsByBlock.get(blockId)
      : null;
    if (assistant) usedExplanationBlocks.add(blockId);
    const display = isWord
      ? (compactText(anchor.reason) || '词语标记')
      : (compactText(assistant?.display) || compactText(anchor.reason));
    if (!display) return [];

    return [{
      id: `reader-lab-analysis-${document.id}-${now}-${index}`,
      documentId: document.id,
      sourceFingerprint,
      selectedText,
      source: selectedText,
      sourceStart,
      sourceEnd: Number.isInteger(anchor.end) ? anchor.end : sourceStart + selectedText.length,
      role: anchor.role,
      importance: anchor.importance,
      reason: compactText(anchor.reason),
      level: isWord ? 'word' : 'sentence',
      markKind: isWord ? (anchor.markKind || 'center') : null,
      // serves 先携带范围引用，待全部记录生成后再映射为记录 id
      servesRange: anchor.serves || null,
      servesTo: null,
      explanation: isWord ? null : (includeInline ? {
        plainExplanation: display,
        display,
        context: '',
        mappings: Array.isArray(assistant?.mappings) ? assistant.mappings : [],
        terms: [],
        mode: assistant?.mode || 'plain',
      } : null),
      terms: [],
      readerLab: true,
      batchAnalysis: true,
      batchKind: kind,
      analysisVersion: analysis.version || 1,
      analysisSummary: compactText(analysis.summary),
      isDemo: Boolean(isDemo),
      createdAt: now,
      updatedAt: now,
    }];
  });

  for (const assistant of analysis.explanations) {
    // 重点批量不生成整块背景解读，只有解读批量需要
    if (!includeInline) break;
    if (usedExplanationBlocks.has(assistant.blockId)) continue;
    const blockIndex = Number.parseInt(assistant.blockId.replace('reader-analysis-block-', ''), 10);
    const block = blocks[blockIndex];
    const display = compactText(assistant.display);
    if (!block || !display) continue;
    records.push({
      id: `reader-lab-analysis-${document.id}-${now}-block-${blockIndex}`,
      documentId: document.id,
      sourceFingerprint,
      selectedText: block.source,
      source: block.source,
      sourceStart: block.sourceStart,
      sourceEnd: block.sourceEnd,
      role: 'background',
      importance: 1,
      reason: '',
      level: 'sentence',
      markKind: null,
      servesTo: null,
      explanation: {
        plainExplanation: display,
        display,
        context: '',
        mappings: Array.isArray(assistant.mappings) ? assistant.mappings : [],
        terms: [],
        mode: assistant.mode || 'plain',
      },
      terms: [],
      readerLab: true,
      batchAnalysis: true,
      batchKind: kind,
      analysisVersion: analysis.version || 1,
      analysisSummary: compactText(analysis.summary),
      isDemo: Boolean(isDemo),
      createdAt: now,
      updatedAt: now,
    });
  }

  // serves 以范围引用服务对象，这里映射为对应记录 id，供结构视图渲染层级支撑
  const recordIdByRange = new Map(
    records.map((record) => [`${record.sourceStart}:${record.sourceEnd}`, record.id])
  );
  for (const record of records) {
    const servesRange = record.servesRange;
    record.servesTo = servesRange
      ? (recordIdByRange.get(`${servesRange.start}:${servesRange.end}`) || null)
      : null;
    delete record.servesRange;
  }

  for (const [recordIndex, record] of records.entries()) {
    const seen = new Set();
    const nextTerms = (record.explanation?.mappings || []).flatMap((mapping) => {
      const source = compactText(mapping?.source);
      const normalizedTerm = source.toLocaleLowerCase('zh-CN');
      if (!source || seen.has(normalizedTerm)) return [];
      // 已掌握术语不再生成解读，辅助层随掌握程度渐隐
      if (masteredSet.has(normalizedTerm)) return [];
      seen.add(normalizedTerm);
      // 别名规整：trim、小写、去重，并剔除与主术语重复项
      const aliasSeed = Array.isArray(mapping?.aliases) ? mapping.aliases : [];
      const seenAliases = new Set([normalizedTerm]);
      const aliases = aliasSeed.flatMap((alias) => {
        const compact = typeof alias === 'string' ? alias.trim().toLowerCase() : '';
        if (!compact || seenAliases.has(compact)) return [];
        seenAliases.add(compact);
        return [compact];
      });
      return [{
        id: `reader-lab-term-${document.id}-${now}-${recordIndex}-${seen.size - 1}`,
        documentId: document.id,
        explanationId: record.id,
        sourceFingerprint,
        term: source,
        normalizedTerm,
        aliases,
        status: 'learning',
        explanation: compactText(mapping?.target),
        note: compactText(mapping?.note),
        isDemo: Boolean(isDemo),
        readerLab: true,
        batchAnalysis: true,
        createdAt: now,
        updatedAt: now,
      }];
    });
    record.terms = nextTerms;
  }

  return records;
}

/**
 * 旧版全文分析记录迁移：早期版本未写入 explanation.mappings，
 * 导致“精准替代”模式静默回退为原文。这里用记录自身的
 * “锚点原文 → 易懂表述”合成一条映射，让旧数据也能驱动替换视图；
 * 已带映射的记录原样保留。返回 { records, migrated }，migrated 为需持久化的记录。
 */
export function migrateBatchAnalysisMappings(records, { now = Date.now() } = {}) {
  const migrated = [];
  const next = (Array.isArray(records) ? records : []).map((record) => {
    if (!record?.batchAnalysis || !record.explanation) return record;
    const existing = Array.isArray(record.explanation.mappings) ? record.explanation.mappings : [];
    if (existing.length > 0) return record;
    const source = compactText(record.source || record.selectedText);
    const target = compactText(record.explanation.display || record.explanation.plainExplanation);
    if (!source || !target || target === source) return record;
    const updated = {
      ...record,
      explanation: {
        ...record.explanation,
        mappings: [{ source, target, note: '旧版分析记录迁移生成的映射' }],
      },
      mappingsMigratedAt: now,
      updatedAt: now,
    };
    migrated.push(updated);
    return updated;
  });
  return { records: next, migrated };
}

/** 统计精准替代视图可用的批量分析记录与映射数量，供无映射提示使用 */
export function precisionReplacementStats(explanations) {
  const batchRecords = (Array.isArray(explanations) ? explanations : [])
    .filter((record) => record?.batchAnalysis);
  const mappingCount = batchRecords.reduce(
    (total, record) => total + (Array.isArray(record.explanation?.mappings) ? record.explanation.mappings.length : 0),
    0
  );
  return { batchRecords: batchRecords.length, mappingCount };
}

export function createReaderLabTerms({
  documentId,
  explanationId,
  selectedText,
  range,
  terms,
  content,
  isDemo = false,
  now = Date.now(),
}) {
  const sourceFingerprint = createSourceFingerprint(content);
  const sourceTerms = Array.isArray(terms) && terms.length > 0
    ? terms
    : [{ source: selectedText, explanation: `“${compactText(selectedText)}”是当前选中的待理解术语。` }];
  const seen = new Set();

  return sourceTerms.flatMap((term, index) => {
    const source = compactText(term?.source);
    const normalizedTerm = source.toLocaleLowerCase('zh-CN');
    if (!source || seen.has(normalizedTerm)) return [];
    seen.add(normalizedTerm);
    // 别名规整：trim、小写、去重，并剔除与主术语重复项
    const aliasSeed = Array.isArray(term?.aliases) ? term.aliases : [];
    const seenAliases = new Set([normalizedTerm]);
    const aliases = aliasSeed.flatMap((alias) => {
      const compact = typeof alias === 'string' ? alias.trim().toLowerCase() : '';
      if (!compact || seenAliases.has(compact)) return [];
      seenAliases.add(compact);
      return [compact];
    });
    return [{
      id: `reader-lab-term-${documentId}-${now}-${index}`,
      documentId,
      explanationId: explanationId || '',
      sourceFingerprint,
      term: source,
      normalizedTerm,
      aliases,
      status: 'learning',
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

/**
 * 把术语记录折叠成"已归一化主术语 -> 聚合条目"的 Map
 * mastered 优先：已掌握记录覆盖学习中记录；别名从所有记录累积
 * 用于解析新文档前收集"用户已懂的术语"，驱动辅助层渐隐
 * @param {Array} termsRecords - 全部术语记录
 * @param {{ excludeDocumentId?: string }} [options]
 * @returns {Map<string, { term: string, normalizedTerm: string, explanation: string, status: string, aliases: string[] }>}
 */
export function collectKnownTerms(termsRecords, { excludeDocumentId } = {}) {
  const known = new Map();
  const list = Array.isArray(termsRecords) ? termsRecords : [];
  for (const record of list) {
    if (!record || record.documentId === excludeDocumentId) continue;
    const normalizedTerm = typeof record.normalizedTerm === 'string' && record.normalizedTerm
      ? record.normalizedTerm
      : (typeof record.term === 'string' ? record.term.toLowerCase() : '');
    if (!normalizedTerm) continue;

    const previous = known.get(normalizedTerm);
    const incomingAliases = Array.isArray(record.aliases) ? record.aliases : [];
    const aliases = previous ? [...previous.aliases] : [];
    const seenAliases = new Set([normalizedTerm, ...aliases]);
    for (const alias of incomingAliases) {
      if (!seenAliases.has(alias)) {
        seenAliases.add(alias);
        aliases.push(alias);
      }
    }

    const incomingMastered = record.status === 'mastered';
    const status = previous
      ? (previous.status === 'mastered' || incomingMastered ? 'mastered' : 'learning')
      : (incomingMastered ? 'mastered' : 'learning');

    known.set(normalizedTerm, {
      term: previous?.term || record.term || normalizedTerm,
      normalizedTerm,
      explanation: previous?.explanation || record.explanation || '',
      status,
      aliases,
    });
  }
  return known;
}

/**
 * 列出已掌握术语（主术语 + 别名），用于在解析请求中告知 AI 不要再解释
 * @param {Array} termsRecords
 * @param {{ excludeDocumentId?: string }} [options]
 * @returns {Array<{ term: string, aliases: string[] }>}
 */
export function listMasteredTerms(termsRecords, options = {}) {
  return [...collectKnownTerms(termsRecords, options).values()]
    .filter((entry) => entry.status === 'mastered')
    .map((entry) => ({ term: entry.term, aliases: entry.aliases }));
}

/**
 * 列出"已接触过解释但尚未掌握"的术语（主术语 + 别名）
 * 与 listMasteredTerms 互补：这些术语仍会被解读，但请求侧会告知 AI 更简练、不跳过
 * 已在某文档中标记为 mastered 的术语不会被列入（collectKnownTerms 中 mastered 优先）
 * @param {Array} termsRecords
 * @param {{ excludeDocumentId?: string }} [options]
 * @returns {Array<{ term: string, aliases: string[] }>}
 */
export function listExplainedTerms(termsRecords, options = {}) {
  return [...collectKnownTerms(termsRecords, options).values()]
    .filter((entry) => entry.status === 'learning')
    .map((entry) => ({ term: entry.term, aliases: entry.aliases }));
}

/**
 * 把用户自维护术语表条目转成"已知术语"形态 { term, aliases }
 * 术语表是用户手工维护的定义背景：请求 AI 时用于交代哪些术语已有既定定义
 * @param {Array<{ term?: string, aliases?: string[] }>} glossaryEntries
 * @returns {Array<{ term: string, aliases: string[] }>}
 */
export function glossaryToKnownTerms(glossaryEntries) {
  // 主术语与别名共用一个去重集合：主术语撞既有别名视为同一术语，不再重复收编
  const seen = new Set();
  const result = [];
  for (const entry of Array.isArray(glossaryEntries) ? glossaryEntries : []) {
    const term = typeof entry?.term === 'string' ? entry.term.trim() : '';
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    const aliases = (Array.isArray(entry?.aliases) ? entry.aliases : [])
      .flatMap((alias) => {
        const compact = typeof alias === 'string' ? alias.trim().toLowerCase() : '';
        if (!compact || seen.has(compact)) return [];
        seen.add(compact);
        return [compact];
      });
    result.push({ term, aliases });
  }
  return result;
}

/**
 * 合并"已掌握术语"与"术语表"两个回灌通道，按归一化主术语去重（已掌握优先保留）
 * 术语表条目视为用户已懂的术语：AI 不再从零解释，且沿用术语表中的既定定义
 * @param {Array<{ term: string, aliases: string[] }>} masteredTerms
 * @param {Array<{ term?: string, aliases?: string[] }>} glossaryEntries
 * @returns {Array<{ term: string, aliases: string[] }>}
 */
export function combineKnownMasteredTerms(masteredTerms, glossaryEntries) {
  const merged = new Map();
  for (const entry of Array.isArray(masteredTerms) ? masteredTerms : []) {
    const term = typeof entry?.term === 'string' ? entry.term.trim() : '';
    if (!term) continue;
    merged.set(term.toLowerCase(), { term, aliases: Array.isArray(entry?.aliases) ? entry.aliases : [] });
  }
  for (const entry of glossaryToKnownTerms(glossaryEntries)) {
    if (!merged.has(entry.term.toLowerCase())) merged.set(entry.term.toLowerCase(), entry);
  }
  return [...merged.values()];
}

/**
 * 合并同义术语：新术语命中既有记录时累积别名、保留已有定义、保持已掌握状态
 * 用于新文档落库时跨文档去重，而非重复建档
 * @param {object} existing - 既有术语记录（可选）
 * @param {object} incoming - 新术语记录
 * @returns {object} 合并后的记录（若 existing 为空则返回 incoming）
 */
export function mergeKnownTerm(existing, incoming) {
  if (!existing) return incoming;

  const normalizeAlias = (alias) => (typeof alias === 'string' ? alias.trim().toLowerCase() : '');
  const seen = new Set([
    existing.normalizedTerm,
    ...(Array.isArray(existing.aliases) ? existing.aliases : []),
  ]);
  const aliases = [...(Array.isArray(existing.aliases) ? existing.aliases : [])];
  const incomingAliases = Array.isArray(incoming.aliases) ? incoming.aliases : [];
  for (const alias of incomingAliases) {
    const compact = normalizeAlias(alias);
    if (!compact || seen.has(compact)) continue;
    seen.add(compact);
    aliases.push(compact);
  }
  // 新记录的主术语若与既有不同，也作为别名累积
  const incomingTerm = normalizeAlias(incoming.normalizedTerm);
  if (incomingTerm && !seen.has(incomingTerm)) {
    aliases.push(incomingTerm);
  }

  return {
    ...existing,
    aliases,
    explanation: existing.explanation || incoming.explanation,
    status: existing.status === 'mastered'
      ? 'mastered'
      : (incoming.status === 'mastered' ? 'mastered' : 'learning'),
    updatedAt: Number.isFinite(incoming.updatedAt) ? incoming.updatedAt : existing.updatedAt,
  };
}
