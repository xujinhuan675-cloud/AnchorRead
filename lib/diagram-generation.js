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
