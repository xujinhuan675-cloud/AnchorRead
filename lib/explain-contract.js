export class ExplainRequestError extends Error {}

export class ExplainResponseError extends Error {}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
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

  return { article, selectedText };
}

/**
 * Validate and canonicalize model output before it crosses the API boundary.
 * Term sources that cannot be located in the supplied source material are
 * discarded instead of exposing model-invented quotations to the reader.
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
      if (!selectedText.includes(term.source) && !article.includes(term.source)) {
        return false;
      }
      seen.add(term.source);
      return true;
    });

  return { plainExplanation, terms, context };
}
