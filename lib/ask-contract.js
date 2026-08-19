/**
 * 划词提问契约：规整请求与 AI 回答
 * 提问使用内置提示词，选区即触发，无需用户输入问题；
 * 回答除正文外可携带"候选词条"——适合沉淀进术语表的稳定概念，
 * 由用户审阅后才入库，因此规整只做防虚构与去重兜底，不做语义判断
 */
import { normalizeGlossaryTerms } from './explain-contract.js';

export class AskRequestError extends Error {}

export class AskResponseError extends Error {}

const MAX_ASK_CANDIDATES = 6;
const MAX_ASK_ALIAS_LENGTH = 100;
const MAX_ASK_ALIASES_PER_TERM = 8;
const MAX_ASK_EXPLANATION_LENGTH = 1_000;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * 入参：{ article, selectedText, glossary }
 * 内置提示词直出，选区与全文为必备要素
 */
export function normalizeAskRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AskRequestError('请求体必须是 JSON 对象');
  }

  const article = nonEmptyString(body.article ?? body.articleContext ?? body.context);
  const selectedText = nonEmptyString(body.selectedText);

  if (!article) throw new AskRequestError('文章上下文为空');
  if (!selectedText) throw new AskRequestError('选中的原文为空');

  return { article, selectedText, glossary: normalizeGlossaryTerms(body.glossary) };
}

/**
 * 出参：{ answer, context, candidates }
 * candidates 允许为空数组（多数提问并没有值得入库的概念）；
 * 命中术语表、无法在原文定位或重复的候选一律丢弃
 */
export function normalizeAskResponse(result, source) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new AskResponseError('AI 未返回有效的回答对象，请重试');
  }

  const answer = nonEmptyString(result.answer);
  if (!answer) {
    throw new AskResponseError('AI 未返回有效的回答，请重试');
  }
  const context = nonEmptyString(result.context);

  const article = nonEmptyString(source?.article);
  const selectedText = nonEmptyString(source?.selectedText);
  // 术语表兜底：命中主术语或别名的候选直接丢弃，避免重复建档
  const glossaryKeys = new Set(
    (Array.isArray(source?.glossary) ? source.glossary : []).flatMap((entry) => [
      nonEmptyString(entry?.term).toLowerCase(),
      ...(Array.isArray(entry?.aliases) ? entry.aliases : []).map((alias) => nonEmptyString(alias).toLowerCase()),
    ].filter(Boolean))
  );

  const seenTerms = new Set();
  const seenKeys = new Set();
  const candidates = (Array.isArray(result.candidates) ? result.candidates : [])
    .slice(0, MAX_ASK_CANDIDATES * 2)
    .filter((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate))
    .map((candidate) => {
      const term = nonEmptyString(candidate.term);
      const termKey = term.toLowerCase();
      const aliases = (Array.isArray(candidate.aliases) ? candidate.aliases : [])
        .flatMap((alias) => {
          const compact = nonEmptyString(alias);
          if (!compact || compact.length > MAX_ASK_ALIAS_LENGTH) return [];
          return [compact];
        })
        .slice(0, MAX_ASK_ALIASES_PER_TERM);
      let explanation = nonEmptyString(candidate.explanation);
      if (explanation.length > MAX_ASK_EXPLANATION_LENGTH) {
        explanation = explanation.slice(0, MAX_ASK_EXPLANATION_LENGTH);
      }
      return { term, termKey, aliases, explanation };
    })
    .filter((candidate) => {
      if (!candidate.term || !candidate.explanation) return false;
      if (seenTerms.has(candidate.termKey)) return false;
      if (glossaryKeys.has(candidate.termKey)) return false;
      // 别名撞既有术语表同样视为已收录
      if (candidate.aliases.some((alias) => glossaryKeys.has(alias.toLowerCase()))) return false;
      // 防虚构：术语必须逐字出现在选区或全文中
      if (!selectedText.includes(candidate.term) && !article.includes(candidate.term)) return false;
      seenTerms.add(candidate.termKey);
      candidate.aliases = candidate.aliases.filter((alias) => {
        const aliasKey = alias.toLowerCase();
        if (seenKeys.has(aliasKey) || aliasKey === candidate.termKey) return false;
        seenKeys.add(aliasKey);
        return true;
      });
      return true;
    })
    .slice(0, MAX_ASK_CANDIDATES)
    .map(({ term, aliases, explanation }) => ({ term, aliases, explanation }));

  return { answer, context, candidates };
}
