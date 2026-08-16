import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentDiagramMessage,
  createDocumentDrawingId,
  createStandaloneDiagramDocument,
  finalizeDiagramSource,
  parseExcalidrawElements,
  STANDALONE_DIAGRAM_DOCUMENT_ID,
} from '../lib/diagram-generation.js';

const document = {
  id: 'doc-42',
  title: '支付幂等设计',
  content: '服务端必须使用幂等键识别同一次支付意图。',
};

test('diagram prompts stay grounded in the active document', () => {
  const request = buildDocumentDiagramMessage({ text: '画出请求到支付结果的关系' }, document);
  assert.match(request.text, /支付幂等设计/);
  assert.match(request.text, /服务端必须使用幂等键/);
  assert.match(request.text, /画出请求到支付结果的关系/);
  assert.match(request.text, /<article>[\s\S]*<\/article>/);
});

test('diagram sources keep Mermaid fences and Excalidraw arrays valid', () => {
  assert.equal(finalizeDiagramSource('mermaid', '```mermaid\ngraph TD\nA-->B\n```'), 'graph TD\nA-->B');
  const source = finalizeDiagramSource('excalidraw', '```json\n[{"type":"text","text":"支付"}]\n```');
  assert.deepEqual(parseExcalidrawElements(source), [{ type: 'text', text: '支付' }]);
});

test('drawing ids are namespaced by document', () => {
  assert.match(createDocumentDrawingId(document.id, 1000, () => 0.5), /^reader-drawing-doc-42-1000-/);
});

test('standalone diagram workspace keeps free diagrams away from reading documents', () => {
  const standalone = createStandaloneDiagramDocument();
  assert.equal(standalone.id, STANDALONE_DIAGRAM_DOCUMENT_ID);
  assert.equal(standalone.standaloneDiagram, true);
  assert.equal(standalone.content, '');
  // 自由图解的提示词不受文章内容约束，不携带 <article> 上下文
  const request = buildDocumentDiagramMessage({ text: '画出用户增长的飞轮' }, standalone);
  assert.doesNotMatch(request.text, /<article>/);
  assert.doesNotMatch(request.text, /支付幂等设计/);
  assert.match(request.text, /画出用户增长的飞轮/);
  assert.match(createDocumentDrawingId(standalone.id, 1000, () => 0.5), /^reader-drawing-reader-lab-standalone-diagrams-1000-/);
});
