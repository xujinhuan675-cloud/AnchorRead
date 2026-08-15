import { createSourceFingerprint } from './provenance.js';
import { findSourceQuoteRange } from './reader-lab.js';

/**
 * 浏览器扩展「原地阅读」收件箱回流合并。
 * 扩展侧在任意网页上采集的解读与术语，经深链握手交回本页；
 * 本模块负责把载荷合并进工作区：术语按名称去重并入术语表，
 * 解读按来源网址匹配既有文档，命中则挂到该文档的解读列表。
 * 纯函数实现，不做持久化，调用方负责写库与更新状态。
 */

const MAX_INBOX_ITEMS = 200;
const MAX_GLOSSARY_TERMS = 200;
const MAX_TEXT_LENGTH = 5_000;

function compactText(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function clampText(value) {
  const text = compactText(value);
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
}

/**
 * 规整来源网址用于匹配：去掉 hash 与结尾斜杠，避免同一页面因
 * 锚点或尾斜杠差异匹配失败。保留查询参数，避免误并不同内容的页面。
 */
export function normalizePageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    // href 会保留 hash，这里显式拼接以去掉锚点；结尾斜杠再统一剥除
    return `${url.origin}${url.pathname}${url.search}`.replace(/\/+$/u, '');
  } catch {
    return '';
  }
}

/** 规整术语别名：trim、小写、去重，并剔除与主术语重复项 */
function normalizeAliases(aliases, normalizedTerm) {
  const seen = new Set([normalizedTerm]);
  return (Array.isArray(aliases) ? aliases : []).flatMap((alias) => {
    const compact = typeof alias === 'string' ? alias.trim().toLowerCase() : '';
    if (!compact || seen.has(compact)) return [];
    seen.add(compact);
    return [compact];
  });
}

/**
 * 合并术语表载荷：命中既有术语表（主术语或别名）的条目跳过，其余生成待保存记录。
 * @returns {{ entries: Array, added: number, skipped: number }}
 */
export function mergeInboxGlossary({ incoming = [], existing = [], now = Date.now() } = {}) {
  const existingKeys = new Set(
    (Array.isArray(existing) ? existing : []).flatMap((entry) => [
      compactText(entry?.term).toLowerCase(),
      ...(Array.isArray(entry?.aliases) ? entry.aliases : []).map((alias) => compactText(alias).toLowerCase()),
    ].filter(Boolean))
  );

  const entries = [];
  const seen = new Set();
  let skipped = 0;
  for (const item of (Array.isArray(incoming) ? incoming : []).slice(0, MAX_GLOSSARY_TERMS)) {
    const term = compactText(item?.term);
    const normalized = term.toLowerCase();
    if (!term || seen.has(normalized)) continue;
    seen.add(normalized);
    if (existingKeys.has(normalized)) {
      skipped += 1;
      continue;
    }
    existingKeys.add(normalized);
    entries.push({
      id: `glossary-inbox-${now}-${entries.length}`,
      term,
      aliases: normalizeAliases(item?.aliases, normalized),
      explanation: clampText(item?.explanation),
      createdAt: now,
      updatedAt: now,
    });
  }
  return { entries, added: entries.length, skipped };
}

/**
 * 合并解读载荷：按来源网址匹配文档，命中生成解读记录（无 ProseMirror 选区，
 * 因此不带 range，仅在知识面板列表展示；能在正文中定位的原文会补 sourceStart/End）。
 * 同文档同选区已有解读时跳过，避免重复回流重复建档。
 * @returns {{ records: Array, attached: number, unmatched: number, duplicates: number }}
 */
export function mergeInboxExplanations({ inboxItems = [], documents = [], explanations = [], now = Date.now() } = {}) {
  const byUrl = new Map(
    (Array.isArray(documents) ? documents : [])
      .filter((document) => document?.id && typeof document.content === 'string')
      .map((document) => [normalizePageUrl(document.sourceUrl || ''), document])
      .filter(([key]) => key)
  );
  const existingSelections = new Set(
    (Array.isArray(explanations) ? explanations : [])
      .map((record) => `${record?.documentId || ''}::${compactText(record?.selectedText).toLowerCase()}`)
  );

  const records = [];
  let unmatched = 0;
  let duplicates = 0;
  for (const item of (Array.isArray(inboxItems) ? inboxItems : []).slice(0, MAX_INBOX_ITEMS)) {
    const selectedText = clampText(item?.selectedText);
    const plainExplanation = clampText(item?.plainExplanation);
    const document = byUrl.get(normalizePageUrl(item?.url || ''));
    if (!document || !selectedText || !plainExplanation) {
      unmatched += 1;
      continue;
    }
    const dedupeKey = `${document.id}::${selectedText.toLowerCase()}`;
    if (existingSelections.has(dedupeKey)) {
      duplicates += 1;
      continue;
    }
    existingSelections.add(dedupeKey);

    const terms = (Array.isArray(item?.terms) ? item.terms : [])
      .map((term) => ({
        source: compactText(term?.source),
        explanation: clampText(term?.explanation),
      }))
      .filter((term) => term.source && term.explanation);
    const located = findSourceQuoteRange(document.content, selectedText);
    const savedAt = Number.isFinite(item?.savedAt) ? item.savedAt : now;

    records.push({
      id: `reader-lab-inbox-${document.id}-${now}-${records.length}`,
      documentId: document.id,
      sourceFingerprint: createSourceFingerprint(document.content),
      selectedText,
      sourceStart: located?.start,
      sourceEnd: located?.end,
      explanation: {
        plainExplanation,
        context: clampText(item?.context),
        terms,
        mappings: terms.map((term) => ({ source: term.source, target: term.explanation, note: '' })),
      },
      terms: [],
      fromInbox: true,
      inboxSourceUrl: typeof item?.url === 'string' ? item.url : '',
      createdAt: savedAt,
      updatedAt: now,
    });
  }
  return { records, attached: records.length, unmatched, duplicates };
}

/**
 * 合并完整收件箱载荷。
 * @param {{ inboxItems?: Array, glossaryTerms?: Array }} payload 扩展交接的载荷
 * @param {{ documents?: Array, glossary?: Array, explanations?: Array, now?: number }} workspace 工作区现状
 * @returns {{ glossaryEntries: Array, explanationRecords: Array, summary: object }}
 */
export function mergeInboxPayload(payload, { documents = [], glossary = [], explanations = [], now = Date.now() } = {}) {
  const glossaryMerge = mergeInboxGlossary({ incoming: payload?.glossaryTerms, existing: glossary, now });
  const explanationMerge = mergeInboxExplanations({
    inboxItems: payload?.inboxItems,
    documents,
    explanations,
    now,
  });
  return {
    glossaryEntries: glossaryMerge.entries,
    explanationRecords: explanationMerge.records,
    summary: {
      addedTerms: glossaryMerge.added,
      skippedTerms: glossaryMerge.skipped,
      attachedExplanations: explanationMerge.attached,
      unmatchedItems: explanationMerge.unmatched,
      duplicates: explanationMerge.duplicates,
    },
  };
}
