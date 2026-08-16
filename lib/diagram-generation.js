import { optimizeExcalidrawCode } from './optimizeArrows.js';
import { repairJsonClosure } from './json-repair.js';
import { stripMermaidFence } from './mermaid-prompts.js';

export function buildDocumentDiagramMessage(message, document) {
  const request = typeof message === 'object' && message !== null
    ? { ...message }
    : { text: String(message || '') };
  const requestText = typeof request.text === 'string' ? request.text.trim() : '';
  request.text = [
    `请基于文章《${document.title}》生成关系图。`,
    '只使用文章中明确出现或能够直接推出的关系，不要补充文章之外的事实。',
    `用户对图表的要求：${requestText || '概括文章的核心概念、因果关系和流程。'}`,
    '',
    '<article>',
    document.content,
    '</article>',
  ].join('\n');
  return request;
}

export function postProcessExcalidrawCode(code) {
  if (!code || typeof code !== 'string') return '';
  let processed = code.trim()
    .replace(/^```(?:json|javascript|js)?\s*\n?/iu, '')
    .replace(/\n?```\s*$/u, '')
    .trim();
  processed = repairJsonClosure(processed);
  try {
    JSON.parse(processed);
    return processed;
  } catch {
    let result = '';
    let inString = false;
    let escapeNext = false;
    for (let index = 0; index < processed.length; index += 1) {
      const char = processed[index];
      if (escapeNext) {
        result += char;
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        result += char;
        escapeNext = true;
        continue;
      }
      if (char !== '"') {
        result += char;
        continue;
      }
      if (!inString) {
        inString = true;
        result += char;
        continue;
      }
      const nextChar = processed.slice(index + 1).match(/^\s*(.)/u)?.[1] || '';
      if ([':', ',', '}', ']', ''].includes(nextChar)) {
        inString = false;
        result += char;
      } else {
        result += '\\"';
      }
    }
    return repairJsonClosure(result);
  }
}

export function parseExcalidrawElements(code) {
  const match = String(code || '').trim().match(/\[[\s\S]*\]/u);
  if (!match) throw new Error('生成结果中没有有效的 Excalidraw JSON 数组。');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error('生成结果不是有效的 Excalidraw 数组。');
  return parsed;
}

export function finalizeDiagramSource(engine, source) {
  return engine === 'mermaid'
    ? stripMermaidFence(source)
    : optimizeExcalidrawCode(postProcessExcalidrawCode(source));
}

export function createDocumentDrawingId(documentId, now = Date.now(), random = Math.random) {
  return `reader-drawing-${documentId}-${now}-${random().toString(36).slice(2, 8)}`;
}

/** Mermaid 脑图节点文案：剔除会触发形状解析的括号与特殊字符，限长保证可读 */
function sanitizeDiagramLabel(text, maxLength = 18) {
  const label = String(text || '')
    .replace(/#{1,6}\s+/gu, '')
    .replace(/[()（）[\]{}【】<>《》"'`|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return label.length > maxLength ? `${label.slice(0, maxLength)}…` : label;
}

/**
 * 无 LLM 配置时的本地图表：直接从文档 Markdown 结构生成真实内容的 Mermaid 脑图，
 * 标题为章节节点、章节后首个正文句为叶子，保证无密钥也能走通图表链路
 * @param {{title?: string, content?: string}} document
 * @returns {string} Mermaid mindmap 源码
 */
export function createDemoDocumentDiagram(document) {
  const lines = String(document?.content || '').split(/\r?\n/u);
  const rootLabel = sanitizeDiagramLabel(document?.title || '文档结构', 24);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/u);
    if (heading) {
      const label = sanitizeDiagramLabel(heading[2]);
      if (!label) continue;
      current = { label, leaves: [] };
      sections.push(current);
      continue;
    }
    // 代码围栏内的行不进脑图，避免语法字符破坏渲染
    if (/^\s*(```|~~~)/u.test(line) || /^\s*\|/u.test(line)) continue;
    const body = line.trim();
    if (!current || !body) continue;
    const sentence = sanitizeDiagramLabel(body.split(/[。！？!?；;]/u)[0], 16);
    if (sentence && current.leaves.length < 2) current.leaves.push(sentence);
  }
  // 无标题的纯段落文档：取前几个正文句直接挂根节点
  if (sections.length === 0) {
    for (const line of lines) {
      const sentence = sanitizeDiagramLabel(line.trim().split(/[。！？!?；;]/u)[0], 16);
      if (!sentence) continue;
      sections.push({ label: sentence, leaves: [] });
      if (sections.length >= 6) break;
    }
  }

  const output = ['mindmap', `  root((${rootLabel}))`];
  for (const section of sections.slice(0, 8)) {
    output.push(`    ${section.label}`);
    for (const leaf of section.leaves) output.push(`      ${leaf}`);
  }
  return output.join('\n');
}
