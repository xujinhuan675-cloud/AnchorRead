import { optimizeExcalidrawCode } from './optimizeArrows.js';
import { repairJsonClosure } from './json-repair.js';
import { stripMermaidFence } from './mermaid-prompts.js';
import { parseExcalidrawScene } from './excalidraw-scene.js';

// 独立图解工作区的保留 documentId：导航「图解」入口不绑定任何阅读文档，
// 自由图解统一挂在这个虚拟文档下，与各文档的绑定图解天然隔离
export const STANDALONE_DIAGRAM_DOCUMENT_ID = 'reader-lab-standalone-diagrams';

/** 独立图解工作区的虚拟文档：只承载图解存储与生成上下文，没有正文 */
export function createStandaloneDiagramDocument() {
  return {
    id: STANDALONE_DIAGRAM_DOCUMENT_ID,
    title: '图解',
    category: '自由画布',
    readMinutes: 0,
    content: '',
    updatedAt: 0,
    readerLab: false,
    standaloneDiagram: true,
  };
}

export function buildDocumentDiagramMessage(message, document) {
  const request = typeof message === 'object' && message !== null
    ? { ...message }
    : { text: String(message || '') };
  const requestText = typeof request.text === 'string' ? request.text.trim() : '';
  // 独立图解工作区的自由图解不绑定文章：直接按用户描述建模，不受文章内容约束
  if (document?.standaloneDiagram) {
    request.text = [
      '请根据用户的描述生成关系图，自由设计概念与它们之间的关系。',
      `用户对图表的要求：${requestText || '概括用户描述中的核心概念、因果关系和流程。'}`,
    ].join('\n');
    return request;
  }
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
  try {
    return parseExcalidrawScene(code).elements;
  } catch {
    // Keep the legacy partial-array recovery path for streamed model output.
  }
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
