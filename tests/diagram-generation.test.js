import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentDiagramMessage,
  createDocumentDrawingId,
  finalizeDiagramSource,
  parseExcalidrawElements,
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
