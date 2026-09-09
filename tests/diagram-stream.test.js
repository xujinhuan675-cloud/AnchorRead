import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStreamTimeline,
  buildRelationshipPlaybackTimeline,
  createDefaultMermaidPresentation,
  createDefaultPresentation,
  excludeIncompleteLastItem,
  parsePartialElements,
  parseStreamSnapshot,
  reconcilePresentationSpec,
  stripPseudoElements,
  timelineToPresentation,
} from '../lib/diagram-stream.js';
import {
  DEFAULT_PRESENTATION_HOLD_MS,
  DEFAULT_PRESENTATION_REVEAL_MS,
  DEFAULT_PRESENTATION_STEP_DURATION_MS,
  getPresentationStepPlaybackDuration,
  normalizePresentationSpec,
} from '../lib/diagram-presentation.js';

test('parsePartialElements tolerates truncated JSON like the official client', () => {
  const partial = '[{"type":"rectangle","id":"a","x":0,"y":0,"width":10,"height":10},{"type":"rect';
  const parsed = parsePartialElements(partial);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'a');
  assert.deepEqual(parsePartialElements('not json'), []);
  assert.deepEqual(parsePartialElements('[{"type":"rectangle","id":"a"}]')[0].id, 'a');
  assert.equal(excludeIncompleteLastItem([1, 2, 3]).length, 2);
});

test('parseStreamSnapshot strips fences, drops trailing partial and pseudo elements', () => {
  // 聊天 SSE 累积文本：围栏 + 完整元素 + 伪元素 + 截断的末尾元素
  const chunk = '```json\n[{"type":"rectangle","id":"a","x":0,"y":0,"width":10,"height":10},'
    + '{"type":"cameraUpdate","x":0,"y":0,"width":800,"height":600},'
    + '{"type":"rectangle","id":"b","x":1';
  const snapshot = parseStreamSnapshot(chunk);
  assert.deepEqual(snapshot.map((element) => element.id), ['a']);
  // 非 JSON / 空文本均降级为空数组，不抛异常
  assert.deepEqual(parseStreamSnapshot('not json'), []);
  assert.deepEqual(parseStreamSnapshot(null), []);
  // 保守策略：末尾元素一律丢弃（无法区分完整/截断），最终画面由 finalize
  // 全量解析补齐，流式预览少一个元素是可接受代价
  assert.deepEqual(
    parseStreamSnapshot('[{"type":"rectangle","id":"a"},{"type":"rectangle","id":"b"}]').map((element) => element.id),
    ['a'],
  );
});

test('buildStreamTimeline follows official drawing order with camera and delete', () => {
  const elements = [
    { type: 'cameraUpdate', x: 0, y: 0, width: 800, height: 600 },
    { type: 'rectangle', id: 'b1', x: 0, y: 0, width: 10, height: 10 },
    { type: 'rectangle', id: 'b2', x: 20, y: 0, width: 10, height: 10 },
    { type: 'delete', ids: 'b1' },
    { type: 'cameraUpdate', x: 100, y: 100, width: 400, height: 300 },
    { type: 'rectangle', id: 'b3', x: 40, y: 0, width: 10, height: 10 },
  ];
  const timeline = buildStreamTimeline(elements);
  assert.equal(timeline.length, 3);
  assert.deepEqual(timeline[0].visibleIds, ['b1']);
  assert.deepEqual(timeline[0].camera, { x: 0, y: 0, width: 800, height: 600 });
  // b2 绘制时 b1 仍在；delete 之后的帧才移除 b1
  assert.deepEqual(timeline[1].visibleIds, ['b1', 'b2']);
  assert.deepEqual(timeline[2].visibleIds, ['b2', 'b3']);
  assert.deepEqual(timeline[2].camera, { x: 100, y: 100, width: 400, height: 300 });
});

test('buildStreamTimeline keeps bound labels with their container frame', () => {
  const timeline = buildStreamTimeline([
    { type: 'rectangle', id: 'start' },
    { type: 'text', id: 'start-label', containerId: 'start', text: '开始' },
    { type: 'arrow', id: 'to-end' },
    { type: 'rectangle', id: 'end' },
    { type: 'text', id: 'end-label', containerId: 'end', text: '结束' },
    { type: 'text', id: 'note', text: '说明' },
    { type: 'rectangle', id: 'deleted', isDeleted: true },
  ]);

  assert.equal(timeline.length, 4);
  assert.deepEqual(timeline.map((frame) => frame.currentId), ['start', 'to-end', 'end', 'note']);
  assert.deepEqual(timeline[2].visibleIds, ['start', 'to-end', 'end']);
  assert.deepEqual(timeline[3].visibleIds, ['start', 'to-end', 'end', 'note']);
});

test('buildStreamTimeline merges frames beyond the presentation step cap', () => {
  const elements = Array.from({ length: 250 }, (_, index) => ({
    type: 'rectangle',
    id: `el-${index}`,
    x: index,
    y: 0,
    width: 10,
    height: 10,
  }));
  const timeline = buildStreamTimeline(elements, { maxFrames: 100 });
  assert.ok(timeline.length <= 100);
  assert.ok(timeline.length > 50);
  // 最后一帧必须包含全部元素（累积可见集）
  assert.equal(timeline[timeline.length - 1].visibleIds.length, 250);
});

test('stripPseudoElements removes cameraUpdate/delete/restoreCheckpoint', () => {
  const stripped = stripPseudoElements([
    { type: 'cameraUpdate', width: 800, height: 600 },
    { type: 'rectangle', id: 'b1' },
    { type: 'delete', ids: 'x' },
    { type: 'restoreCheckpoint', id: 'cp' },
  ]);
  assert.deepEqual(stripped.map((element) => element.id), ['b1']);
});

test('timelineToPresentation preserves an explicitly requested camera region', () => {
  const timeline = buildStreamTimeline([
    { type: 'cameraUpdate', x: 10, y: 20, width: 800, height: 600 },
    { type: 'rectangle', id: 'b1', x: 0, y: 0, width: 10, height: 10 },
  ]);
  const spec = normalizePresentationSpec(timelineToPresentation(timeline, { durationMs: 500, includeCamera: true }));
  assert.equal(spec.steps.length, 1);
  assert.equal(spec.steps[0].durationMs, 500);
  assert.deepEqual(spec.steps[0].visibleElementIds, ['b1']);
  assert.deepEqual(spec.steps[0].focusElementIds, []);
  assert.deepEqual(spec.steps[0].camera, { region: { x: 10, y: 20, width: 800, height: 600 } });
});

test('default presentations reveal each element on a stable overview', () => {
  const excalidraw = createDefaultPresentation([
    { type: 'rectangle', id: 'start' },
    { type: 'arrow', id: 'next' },
    { type: 'rectangle', id: 'end' },
  ]);
  assert.equal(excalidraw.steps.length, 3);
  assert.deepEqual(excalidraw.steps[0].visibleElementIds, ['start']);
  assert.deepEqual(excalidraw.steps[1].visibleElementIds, ['start', 'next']);
  assert.deepEqual(excalidraw.steps[2].visibleElementIds, ['start', 'next', 'end']);
  assert.deepEqual(excalidraw.steps[2].focusElementIds, []);
  assert.equal(excalidraw.steps[2].durationMs, DEFAULT_PRESENTATION_STEP_DURATION_MS);
  assert.equal(excalidraw.steps[2].revealMs, DEFAULT_PRESENTATION_REVEAL_MS);
  assert.equal(excalidraw.steps[2].holdMs, DEFAULT_PRESENTATION_HOLD_MS);

  const mermaid = createDefaultMermaidPresentation('flowchart TD\nA[开始] --> B[结束]');
  assert.equal(mermaid.steps.length, 2);
  assert.deepEqual(mermaid.steps[1].visibleElementIds, ['mermaid-1', 'mermaid-2']);
  assert.deepEqual(mermaid.steps[1].focusElementIds, []);
  assert.equal(createDefaultMermaidPresentation('%% only comment'), null);
});

test('default playback preserves one step per element and keeps generated camera movement disabled', () => {
  const complex = Array.from({ length: 40 }, (_item, index) => ({
    type: 'rectangle', id: `node-${index + 1}`, x: index * 20, y: 0, width: 10, height: 10,
  }));
  const presentation = createDefaultPresentation(complex);
  assert.equal(presentation.steps.length, 40);
  assert.equal(presentation.steps.at(-1).visibleElementIds.length, 40);

  assert.ok(presentation.steps.every((step) => step.camera === undefined));

  const cameraPresentation = timelineToPresentation(buildStreamTimeline([
    { type: 'cameraUpdate', x: 0, y: 0, width: 800, height: 600 },
    { type: 'rectangle', id: 'a' },
    { type: 'rectangle', id: 'b' },
  ]), { includeCamera: true });
  assert.ok(cameraPresentation.steps[0].camera);
  assert.equal(cameraPresentation.steps[1].camera, undefined);
});

test('relationship playback reveals bound endpoints before the connector and names the relation', () => {
  const elements = [
    { type: 'rectangle', id: 'source', label: { text: '用户' } },
    { type: 'arrow', id: 'edge', startElementId: 'source', endElementId: 'target', label: { text: '提交任务' } },
    { type: 'rectangle', id: 'target', label: { text: 'Agent' } },
  ];
  const timeline = buildRelationshipPlaybackTimeline(elements);
  assert.deepEqual(timeline.map((frame) => frame.currentId), ['source', 'target', 'edge']);
  assert.deepEqual(timeline.map((frame) => frame.visibleIds), [
    ['source'],
    ['source', 'target'],
    ['source', 'target', 'edge'],
  ]);
  assert.equal(timeline[0].title, '用户');
  assert.equal(timeline[1].title, 'Agent');
  assert.equal(timeline[2].title, '用户 —提交任务→ Agent');
  const presentation = createDefaultPresentation(elements);
  assert.deepEqual(presentation.steps.map((step) => step.title), ['用户', 'Agent', '用户 —提交任务→ Agent']);
});

test('relationship playback supports Excalidraw bindings and keeps bound labels with the connector', () => {
  const timeline = buildRelationshipPlaybackTimeline([
    { type: 'rectangle', id: 'a', label: { text: 'A' } },
    { type: 'arrow', id: 'ab', startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' } },
    { type: 'rectangle', id: 'b' },
    { type: 'text', id: 'ab-label', containerId: 'ab', text: '调用' },
  ]);
  assert.deepEqual(timeline.map((frame) => frame.currentId), ['a', 'b', 'ab']);
  assert.equal(timeline.at(-1).title, 'A —调用→ 节点');
  assert.equal(timeline.length, 3);
});

test('relationship playback interleaves connectors when scene render order lists nodes first', () => {
  const timeline = buildRelationshipPlaybackTimeline([
    { type: 'rectangle', id: 'a', label: { text: 'A' } },
    { type: 'rectangle', id: 'b', label: { text: 'B' } },
    { type: 'rectangle', id: 'c', label: { text: 'C' } },
    { type: 'arrow', id: 'ab', startElementId: 'a', endElementId: 'b', label: { text: '到达' } },
    { type: 'arrow', id: 'bc', startElementId: 'b', endElementId: 'c', label: { text: '继续' } },
  ]);
  assert.deepEqual(timeline.map((frame) => frame.currentId), ['a', 'b', 'ab', 'c', 'bc']);
  assert.equal(timeline[2].title, 'A —到达→ B');
  assert.equal(timeline[4].title, 'B —继续→ C');
});

test('playback timing preserves a readable hold and supports speed choices', () => {
  const legacyFastStep = { durationMs: 500, transitionMs: 450, revealMs: 360, holdMs: 900, focusElementIds: ['a'] };
  assert.equal(getPresentationStepPlaybackDuration(legacyFastStep), 1350);
  assert.equal(getPresentationStepPlaybackDuration(legacyFastStep, 0.75), 1800);
  assert.equal(getPresentationStepPlaybackDuration({ focusElementIds: [] }), DEFAULT_PRESENTATION_STEP_DURATION_MS);
});

test('legacy generated presentations rebuild with the human playback policy', () => {
  const legacy = {
    title: '流式重放',
    steps: [
      { id: 'stream-1', durationMs: 500, transitionMs: 450, visibleElementIds: ['start'], focusElementIds: ['start'] },
      { id: 'stream-2', durationMs: 500, transitionMs: 450, visibleElementIds: ['start', 'next'], focusElementIds: ['next'] },
      { id: 'stream-3', durationMs: 500, transitionMs: 450, visibleElementIds: ['start', 'next', 'end'], focusElementIds: ['end'] },
    ],
  };
  const rebuilt = reconcilePresentationSpec(legacy, [
    { type: 'rectangle', id: 'start' },
    { type: 'arrow', id: 'next' },
    { type: 'rectangle', id: 'end' },
  ]);
  assert.equal(rebuilt.steps.length, 3);
  assert.deepEqual(rebuilt.steps.at(-1).focusElementIds, []);
  assert.equal(rebuilt.steps.at(-1).durationMs, DEFAULT_PRESENTATION_STEP_DURATION_MS);
});

test('reconcilePresentationSpec appends added elements as highlighted steps after the original flow', () => {
  const spec = {
    title: '流式重放',
    steps: [
      { id: 's1', visibleElementIds: ['a'] },
      { id: 's2', visibleElementIds: ['a', 'b'], camera: { region: { x: 0, y: 0, width: 100, height: 100 } } },
    ],
  };
  const elements = [
    { type: 'rectangle', id: 'a' },
    { type: 'rectangle', id: 'b' },
    { type: 'rectangle', id: 'c' },
    { type: 'rectangle', id: 'd' },
    // 绑定文本随容器归属可见，不算新增
    { type: 'text', id: 't1', containerId: 'd' },
  ];
  const reconciled = reconcilePresentationSpec(spec, elements);
  // 原流程两步不变（相机编排保留），新增 c/d 按添加顺序各占一步
  assert.equal(reconciled.steps.length, 4);
  assert.deepEqual(reconciled.steps[1].visibleElementIds, ['a', 'b']);
  assert.deepEqual(reconciled.steps[1].camera, spec.steps[1].camera);
  assert.deepEqual(reconciled.steps[2].visibleElementIds, ['a', 'b', 'c']);
  assert.deepEqual(reconciled.steps[2].highlightElementIds, ['c']);
  assert.deepEqual(reconciled.steps[3].visibleElementIds, ['a', 'b', 'c', 'd']);
  assert.deepEqual(reconciled.steps[3].highlightElementIds, ['d']);
  // 纯函数：入参不被修改
  assert.equal(spec.steps.length, 2);
});

test('reconcilePresentationSpec folds additions into the last step beyond the step cap', () => {
  const spec = {
    steps: Array.from({ length: 100 }, (_, index) => ({
      id: `s${index + 1}`,
      visibleElementIds: ['base'],
    })),
  };
  const elements = [
    { type: 'rectangle', id: 'base' },
    { type: 'rectangle', id: 'x1' },
    { type: 'rectangle', id: 'x2' },
  ];
  const reconciled = reconcilePresentationSpec(spec, elements);
  // 步数不超上限：新增折叠进最后一步
  assert.equal(reconciled.steps.length, 100);
  assert.deepEqual(reconciled.steps[99].visibleElementIds, ['base', 'x1', 'x2']);
});

test('reconcilePresentationSpec rebuilds when the saved script is stale', () => {
  const spec = { steps: [{ id: 's1', visibleElementIds: ['old1', 'old2'] }] };
  const elements = [
    { type: 'rectangle', id: 'n1', x: 0, y: 0, width: 10, height: 10 },
    { type: 'rectangle', id: 'n2', x: 20, y: 0, width: 10, height: 10 },
  ];
  const reconciled = reconcilePresentationSpec(spec, elements);
  assert.equal(reconciled.steps.length, 2);
  assert.deepEqual(reconciled.steps[1].visibleElementIds, ['n1', 'n2']);
});

test('reconcilePresentationSpec keeps matching specs and passthrough edge cases', () => {
  const spec = { steps: [{ id: 's1', visibleElementIds: ['a', 'b'] }] };
  const same = reconcilePresentationSpec(spec, [{ type: 'rectangle', id: 'a' }, { type: 'rectangle', id: 'b' }]);
  assert.equal(same, spec);
  // 无引用脚本（纯相机）原样保留；空画布/空脚本安全降级
  const cameraOnly = { steps: [{ id: 's1', camera: { zoom: 1 } }] };
  assert.equal(reconcilePresentationSpec(cameraOnly, [{ type: 'rectangle', id: 'x' }]), cameraOnly);
  assert.equal(reconcilePresentationSpec(null, []), null);
  assert.equal(reconcilePresentationSpec(spec, []), spec);
});
