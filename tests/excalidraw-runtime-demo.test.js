import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalDemoDrawing, createRuntimeSwimlaneDemoElements } from '../lib/excalidraw-runtime-demo.js';

test('runtime demo builds six lanes, twenty numbered steps and editable connectors', () => {
  const elements = createRuntimeSwimlaneDemoElements();
  const ids = new Set(elements.map((element) => element.id));

  assert.equal(elements.filter((element) => /^lane-\d$/.test(element.id)).length, 6);
  assert.equal(elements.filter((element) => /^s\d+-badge$/.test(element.id)).length, 20);
  assert.ok(elements.filter((element) => element.type === 'arrow').length >= 20);
  assert.ok(elements.every((element) => element.id && !element.isDeleted));
  assert.equal(ids.size, elements.length);
});

test('runtime demo keeps reference-image landmarks in editable text elements', () => {
  const elements = createRuntimeSwimlaneDemoElements();
  const labels = elements
    .flatMap((element) => [element.text, element.label?.text])
    .filter(Boolean)
    .join('\n');

  assert.match(labels, /企业 Agent 运行时链路/);
  assert.match(labels, /Router 调度/);
  assert.match(labels, /Worker 执行/);
  assert.match(labels, /MCP 连接层/);
  assert.match(labels, /Judge 校验/);
  assert.match(labels, /会话记忆 Session/);
});

test('runtime demo is persisted as a standalone editable Excalidraw drawing', () => {
  const drawing = createLocalDemoDrawing(1234);
  const parsed = JSON.parse(drawing.source);

  assert.equal(drawing.documentId, 'reader-lab-standalone-diagrams');
  assert.equal(drawing.engine, 'excalidraw');
  assert.equal(drawing.isLocalDemo, true);
  assert.equal(drawing.createdAt, 1234);
  assert.equal(drawing.updatedAt, 1234);
  assert.equal(parsed.length, createRuntimeSwimlaneDemoElements().length);
});
