export class ExplainRequestError extends Error {}

export class ExplainResponseError extends Error {}

const MAX_GLOSSARY_TERMS = 200;
const MAX_GLOSSARY_ALIAS_LENGTH = 100;
const MAX_GLOSSARY_ALIASES_PER_TERM = 8;
const MAX_GLOSSARY_EXPLANATION_LENGTH = 1_000;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * 规整用户自维护术语表：每条形如 { term, aliases, explanation }
 * 作为背景交代给 AI：这些术语已有既定定义，不再列为新术语
 */
function normalizeGlossaryTerms(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  // 主术语与别名共用一个去重集合：主术语撞既有别名视为同一术语，不再重复收编
  const seenKeys = new Set();
  for (const entry of value.slice(0, MAX_GLOSSARY_TERMS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const term = nonEmptyString(entry.term).toLowerCase();
    if (!term || seenKeys.has(term)) continue;
    seenKeys.add(term);
    const aliases = (Array.isArray(entry.aliases) ? entry.aliases : [])
      .flatMap((alias) => {
        const compact = nonEmptyString(alias).toLowerCase();
        if (!compact || compact.length > MAX_GLOSSARY_ALIAS_LENGTH || seenKeys.has(compact)) return [];
        seenKeys.add(compact);
        return [compact];
      })
      .slice(0, MAX_GLOSSARY_ALIASES_PER_TERM);
    const explanation = nonEmptyString(entry.explanation);
    if (explanation.length > MAX_GLOSSARY_EXPLANATION_LENGTH) {
      throw new ExplainRequestError(
        `术语表定义不能超过 ${MAX_GLOSSARY_EXPLANATION_LENGTH} 个字符`
      );
    }
    result.push({ term, aliases, explanation });
  }
  return result;
}

/**
 * Accept the canonical `article` field and a pair of descriptive aliases so
 * callers can pass either a whole document or a smaller article context.
 */
export function normalizeExplainRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ExplainRequestError('请求体必须是 JSON 对象');
  }

  const article = nonEmptyString(
    body.article ?? body.articleContext ?? body.context
  );
  const selectedText = nonEmptyString(body.selectedText);

  if (!article) {
    throw new ExplainRequestError('文章上下文为空');
  }
  if (!selectedText) {
    throw new ExplainRequestError('选中的原文为空');
  }

  return { article, selectedText, glossary: normalizeGlossaryTerms(body.glossary) };
}

/**
 * Validate and canonicalize model output before it crosses the API boundary.
 * Term sources that cannot be located in the supplied source material are
 * discarded instead of exposing model-invented quotations to the reader.
 * Terms already covered by the user glossary are also dropped so they never
 * re-enter the explanation as fresh vocabulary.
 */
export function normalizeExplainResponse(result, source) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ExplainResponseError('AI 未返回有效的解释对象，请重试');
  }

  const plainExplanation = nonEmptyString(result.plainExplanation);
  const context = nonEmptyString(result.context);

  if (!plainExplanation) {
    throw new ExplainResponseError('AI 未返回有效的白话解释，请重试');
  }
  if (!context) {
    throw new ExplainResponseError('AI 未返回有效的上下文说明，请重试');
  }
  if (!Array.isArray(result.terms)) {
    throw new ExplainResponseError('AI 返回的术语列表格式无效，请重试');
  }

  const article = nonEmptyString(source?.article);
  const selectedText = nonEmptyString(source?.selectedText);
  // 术语表兜底：命中主术语或别名的返回项直接丢弃，避免 AI 不听话时重复建档
  const glossaryKeys = new Set(
    (Array.isArray(source?.glossary) ? source.glossary : []).flatMap((entry) => [
      nonEmptyString(entry?.term).toLowerCase(),
      ...(Array.isArray(entry?.aliases) ? entry.aliases : []).map((alias) => nonEmptyString(alias).toLowerCase()),
    ].filter(Boolean))
  );
  const seen = new Set();
  const terms = result.terms
    .filter((term) => term && typeof term === 'object' && !Array.isArray(term))
    .map((term) => ({
      source: nonEmptyString(term.source),
      explanation: nonEmptyString(term.explanation),
    }))
    .filter((term) => {
      if (!term.source || !term.explanation || seen.has(term.source)) {
        return false;
      }
      if (glossaryKeys.has(term.source.toLowerCase())) {
        return false;
      }
      if (!selectedText.includes(term.source) && !article.includes(term.source)) {
        return false;
      }
      seen.add(term.source);
      return true;
    });

  return { plainExplanation, terms, context };
}
