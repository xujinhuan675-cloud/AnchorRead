import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryWorkspaceAdapter, createWorkspaceRepository } from '../lib/local-workspace-db.js';
import { executeDiagramAgentCommand } from '../lib/diagram-agent-commands.js';
import { STANDALONE_DIAGRAM_DOCUMENT_ID } from '../lib/diagram-generation.js';
import { commitDiagramScene, getDrawingScene } from '../lib/diagram-scene-record.js';
import { createMcpToolResult } from '../lib/diagram-mcp-links.js';

function repository() {
  return createWorkspaceRepository(createMemoryWorkspaceAdapter());
}

test('design guide is available before a browser workspace is initialized', async () => {
  const result = await executeDiagramAgentCommand({ tool: 'read_diagram_guide', args: {} });
  assert.equal(result.source.commit, '713706e967ed21db1d9264748fa01c6af961c792');
  assert.deepEqual(result.workflow, [
    'read_diagram_guide',
    'create_or_update',
    'describe_scene',
    'align_or_distribute',
    'get_canvas_screenshot',
    'fix_and_repeat_until_quality_passes',
  ]);
  assert.match(result.guide, /Minimum shape size/i);
  assert.match(result.guide, /4:3 camera region/i);
  assert.match(result.guide, /screenshot again/i);
});

test('creates and reads a diagram in the browser workspace without a file round-trip', async () => {
  const workspace = repository();
  let opened = null;
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: '流程骨干',
      engine: 'excalidraw',
      scene: { elements: [{ id: 'start', type: 'text', x: 10, y: 20, text: '开始' }] },
      open: true,
    },
  }, { repository: workspace, onOpen: (drawing) => { opened = drawing; }, now: 100 });

  assert.equal(created.documentId, STANDALONE_DIAGRAM_DOCUMENT_ID);
  assert.equal(created.revision, 1);
  assert.match(created.url, new RegExp(`/diagrams/${created.routeId}$`));
  assert.equal(created.openAction, 'open_url_if_supported');
  assert.equal(created.openTarget, 'default_browser');
  assert.equal(created.openResource.kind, 'diagram');
  assert.equal(created.nextAction, 'verify_diagram');
  assert.equal(opened.id, created.id);
  assert.equal((await workspace.drawings.list()).length, 1);

  const workspaceLink = await executeDiagramAgentCommand({
    tool: 'open_diagram_workspace',
    args: {},
  }, { repository: workspace });
  assert.equal(workspaceLink.openAction, 'open_url_if_supported');
  assert.equal(workspaceLink.openResource.kind, 'workspace');
  assert.match(workspaceLink.url, /\/diagrams$/);

  const result = await executeDiagramAgentCommand({
    tool: 'get_diagram',
    args: { id: created.routeId },
  }, { repository: workspace });
  assert.equal(result.scene.elements[0].text, '开始');
});

test('persists the compact elements input used by the official Excalidraw contract', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Elements input',
      engine: 'excalidraw',
      elements: [{ id: 'node', type: 'rectangle', x: 20, y: 30, width: 140, height: 60, label: { text: '节点' } }],
      open: false,
    },
  }, { repository: workspace, now: 101 });

  assert.equal(created.openRequested, false);
  assert.equal(created.scene.elements[0].id, 'node');
  assert.equal(created.scene.elements[0].label.text, '节点');
});

test('renders a screenshot from the requested drawing instead of an arbitrary DOM canvas', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: { title: 'Screenshot target', engine: 'excalidraw', elements: [{ id: 'node', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }] },
  }, { repository: workspace, now: 102 });
  let capturedDrawing = null;
  const expected = { content: [{ type: 'image', data: 'png', mimeType: 'image/png' }] };

  const result = await executeDiagramAgentCommand({
    tool: 'get_canvas_screenshot',
    args: { id: created.id },
  }, {
    repository: workspace,
    screenshot: async (drawing) => {
      capturedDrawing = drawing;
      return expected;
    },
  });

  assert.equal(capturedDrawing.id, created.id);
  assert.deepEqual(result, expected);
});

test('verify_diagram closes the structure and visual quality loop', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Verification loop',
      engine: 'excalidraw',
      elements: [
        { id: 'source', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, label: { text: 'Source' } },
        { id: 'target', type: 'rectangle', x: 280, y: 0, width: 160, height: 80, label: { text: 'Target' } },
        { id: 'edge', type: 'arrow', x: 160, y: 20, width: 120, height: 0, startElementId: 'source', endElementId: 'target', label: { text: 'calls' } },
      ],
      open: false,
    },
  }, { repository: workspace, now: 106 });
  const verified = await executeDiagramAgentCommand({
    tool: 'verify_diagram',
    args: { id: created.id },
  }, {
    repository: workspace,
    screenshot: async () => ({ content: [{ type: 'image', data: 'png', mimeType: 'image/png' }] }),
  });

  const verifiedPayload = verified.structuredContent || verified;
  assert.equal(verifiedPayload.id, created.id);
  assert.equal(verifiedPayload.revision, 1);
  assert.equal(verifiedPayload.preflight.status, 'pass');
  assert.match(verifiedPayload.description, /Total elements: 3/);
  assert.equal(verifiedPayload.visual.available, true);
  assert.equal(verifiedPayload.nextAction, 'none');
});

test('create_diagram rejects duplicate element ids before persistence', async () => {
  const workspace = repository();
  await assert.rejects(
    executeDiagramAgentCommand({
      tool: 'create_diagram',
      args: {
        title: 'Invalid scene',
        engine: 'excalidraw',
        elements: [
          { id: 'duplicate', type: 'rectangle', width: 160, height: 80 },
          { id: 'duplicate', type: 'ellipse', width: 160, height: 80 },
        ],
      },
    }, { repository: workspace, now: 107 }),
    (error) => error.code === 'SCENE_PREFLIGHT_FAILED'
      && error.preflight?.errors?.some((item) => item.code === 'DUPLICATE_ELEMENT_ID'),
  );
  assert.equal((await workspace.drawings.list()).length, 0);
});

test('create_diagram rejects unsafe fan-out routes before persistence', async () => {
  const workspace = repository();
  await assert.rejects(
    executeDiagramAgentCommand({
      tool: 'create_diagram',
      args: {
        title: 'Unsafe fan-out',
        engine: 'excalidraw',
        elements: [
          { id: 'source', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, label: { text: '来源' } },
          { id: 'first', type: 'rectangle', x: 0, y: 140, width: 120, height: 60, label: { text: '第一路' } },
          { id: 'second', type: 'rectangle', x: 220, y: 140, width: 120, height: 60, label: { text: '第二路' } },
          { id: 'to-first', type: 'arrow', x: 0, y: 60, width: 0, height: 80, startElementId: 'source', endElementId: 'first' },
          { id: 'to-second', type: 'arrow', x: 0, y: 60, width: 220, height: 80, startElementId: 'source', endElementId: 'second' },
        ],
      },
    }, { repository: workspace, now: 108 }),
    (error) => error.code === 'SCENE_PREFLIGHT_FAILED'
      && error.preflight?.errors?.filter((item) => item.code === 'CONNECTOR_ROUTING_RISK')
        .map((item) => item.elementIds[0])
        .sort()
        .join(',') === 'to-first,to-second',
  );
  assert.equal((await workspace.drawings.list()).length, 0);
});

test('content diagrams receive a default presentation and play when opened', async () => {
  const workspace = repository();
  const events = [];
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Default playback',
      engine: 'excalidraw',
      elements: [
        { id: 'start', type: 'rectangle', x: 0, y: 0, width: 120, height: 50, label: { text: '开始' } },
        { id: 'process', type: 'rectangle', x: 0, y: 100, width: 120, height: 50, label: { text: '处理' } },
        { id: 'end', type: 'rectangle', x: 0, y: 200, width: 120, height: 50, label: { text: '结束' } },
      ],
    },
  }, { repository: workspace, onPresentation: (event) => events.push(event), now: 103 });

  assert.equal(created.presentation.steps.length, 3);
  assert.equal(created.presentation.steps.at(-1).visibleElementIds.join(','), 'start,process,end');
  assert.equal(created.presentationAutoPlayed, true);
  assert.deepEqual(events.map((event) => event.action), ['play']);

  const relationship = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Relationship playback',
      engine: 'excalidraw',
      elements: [
        { id: 'source', type: 'rectangle', x: 0, y: 0, width: 120, height: 50, label: { text: '请求' } },
        { id: 'edge', type: 'arrow', x: 0, y: 0, width: 120, height: 100, startElementId: 'source', endElementId: 'target', label: { text: '触发' } },
        { id: 'target', type: 'rectangle', x: 0, y: 100, width: 120, height: 50, label: { text: '处理' } },
      ],
      open: false,
    },
  }, { repository: workspace, now: 103.5 });
  assert.deepEqual(relationship.presentation.steps.map((step) => step.visibleElementIds), [
    ['source'],
    ['source', 'target'],
    ['source', 'target', 'edge'],
  ]);
  assert.equal(relationship.presentation.steps.at(-1).title, '请求 —触发→ 处理');

  const authored = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Authored presentation',
      engine: 'excalidraw',
      elements: relationship.scene.elements,
      presentation: {
        title: 'AI 讲解顺序',
        steps: [{ id: 'authored', title: '先看关系结果', visibleElementIds: ['source', 'target', 'edge'] }],
      },
      open: false,
    },
  }, { repository: workspace, now: 103.75 });
  assert.equal(authored.presentation.title, 'AI 讲解顺序');
  assert.deepEqual(authored.presentation.steps[0].visibleElementIds, ['source', 'target', 'edge']);

  // A legacy record without a stored script still exposes the same playback contract.
  const legacy = { ...created };
  delete legacy.presentation;
  await workspace.drawings.save(legacy);
  const recovered = await executeDiagramAgentCommand({ tool: 'get_presentation', args: { id: created.id } }, { repository: workspace });
  assert.equal(recovered.presentation.steps.length, 3);
  const played = await executeDiagramAgentCommand({ tool: 'play_presentation', args: { id: created.id } }, { repository: workspace, onPresentation: (event) => events.push(event) });
  assert.equal(played.stepCount, 3);

  const inferredElements = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: { title: 'Inferred elements', elements: [{ id: 'node', type: 'rectangle', x: 0, y: 0, width: 40, height: 20 }], open: false },
  }, { repository: workspace, now: 104 });
  assert.equal(inferredElements.engine, 'excalidraw');
  assert.equal(inferredElements.presentation.steps.length, 1);

  const inferredSource = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: { title: 'Inferred source', source: 'flowchart TD\nA-->B', open: false },
  }, { repository: workspace, now: 105 });
  assert.equal(inferredSource.engine, 'mermaid');
  assert.equal(inferredSource.presentation.steps.length, 2);

  const changedSource = { ...inferredSource, source: 'flowchart TD\nA-->B\nB-->C' };
  await workspace.drawings.save(changedSource);
  const refreshed = await executeDiagramAgentCommand({ tool: 'get_presentation', args: { id: inferredSource.id } }, { repository: workspace });
  assert.equal(refreshed.presentation.steps.length, 3);
  assert.equal(refreshed.presentation.steps.at(-1).visibleElementIds.at(-1), 'mermaid-3');
});

test('fit viewport treats viewportZoomFactor as padding instead of final zoom', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Viewport input',
      engine: 'excalidraw',
      scene: { elements: [{ id: 'wide', type: 'rectangle', x: 0, y: 0, width: 1000, height: 100 }] },
    },
  }, { repository: workspace, now: 102 });

  const fitted = await executeDiagramAgentCommand({
    tool: 'set_viewport',
    args: { id: created.id, scrollToContent: true, viewportZoomFactor: 0.8 },
  }, { repository: workspace });

  // Node has no DOM viewport, so the command uses its 1280x800 fallback:
  // 0.8 * 1280 / 1000 = 1.024, rather than incorrectly persisting 0.8.
  assert.equal(fitted.scene.appState.zoom.value, 1.024);
});

test('applies live browser patches with optimistic revision checks', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: { title: 'Patch', engine: 'excalidraw', scene: { elements: [] } },
  }, { repository: workspace, now: 100 });
  const patched = await executeDiagramAgentCommand({
    tool: 'apply_diagram_patch',
    args: {
      id: created.id,
      expectedRevision: 1,
      patch: { create: [{ id: 'node', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }] },
    },
  }, { repository: workspace, now: 200 });
  assert.equal(patched.revision, 2);
  await assert.rejects(
    executeDiagramAgentCommand({
      tool: 'apply_diagram_patch',
      args: { id: created.id, expectedRevision: 1, patch: { create: [] } },
    }, { repository: workspace }),
    (error) => error.code === 'REVISION_CONFLICT',
  );
});

test('supports diagram-scoped element CRUD with revision protection', async () => {
  const workspace = repository();
  const first = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: { title: 'Element CRUD A', engine: 'excalidraw', scene: { elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 40, height: 20 }] } },
  }, { repository: workspace, now: 100 });
  const second = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: { title: 'Element CRUD B', engine: 'excalidraw', scene: { elements: [{ id: 'b', type: 'rectangle', x: 0, y: 0, width: 40, height: 20 }] } },
  }, { repository: workspace, now: 101 });

  const created = await executeDiagramAgentCommand({
    tool: 'create_element',
    args: { id: first.id, expectedRevision: 1, element: { id: 'new', type: 'text', x: 60, y: 0, text: 'Draft' } },
  }, { repository: workspace, now: 110 });
  assert.equal(created.revision, 2);
  assert.equal(created.element.text, 'Draft');

  const queried = await executeDiagramAgentCommand({
    tool: 'query_elements',
    args: { id: first.routeId, filters: { text: 'draft' } },
  }, { repository: workspace });
  assert.deepEqual(queried.map((element) => element.id), ['new']);

  const updated = await executeDiagramAgentCommand({
    tool: 'update_element',
    args: { id: first.id, elementId: 'new', changes: { text: 'Published', x: 80 }, expectedRevision: 2 },
  }, { repository: workspace, now: 120 });
  assert.equal(updated.revision, 3);
  assert.equal(updated.element.text, 'Published');
  assert.equal(updated.element.x, 80);

  const read = await executeDiagramAgentCommand({
    tool: 'get_element',
    args: { id: first.id, elementId: 'new' },
  }, { repository: workspace });
  assert.equal(read.element.text, 'Published');

  const deleted = await executeDiagramAgentCommand({
    tool: 'delete_element',
    args: { id: first.id, elementId: 'new', expectedRevision: 3 },
  }, { repository: workspace, now: 130 });
  assert.equal(deleted.revision, 4);
  assert.equal(deleted.element.isDeleted, true);
  assert.deepEqual(await executeDiagramAgentCommand({ tool: 'query_elements', args: { id: first.id, filters: { ids: ['new'] } } }, { repository: workspace }), []);
  assert.equal((await executeDiagramAgentCommand({ tool: 'get_element', args: { id: first.id, elementId: 'new', includeDeleted: true } }, { repository: workspace })).element.isDeleted, true);

  const cleared = await executeDiagramAgentCommand({
    tool: 'clear_canvas',
    args: { id: first.id, expectedRevision: 4 },
  }, { repository: workspace, now: 140 });
  assert.equal(cleared.revision, 5);
  assert.equal(cleared.deletedCount, 1);
  assert.equal((await executeDiagramAgentCommand({ tool: 'query_elements', args: { id: second.id } }, { repository: workspace })).length, 1);

  await assert.rejects(
    executeDiagramAgentCommand({ tool: 'create_element', args: { id: first.id, expectedRevision: 4, element: { id: 'stale', type: 'text', text: 'stale' } } }, { repository: workspace }),
    (error) => error.code === 'REVISION_CONFLICT',
  );
});

test('migrated canvas tools operate on the browser workspace and retain named snapshots', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Canvas tools',
      engine: 'excalidraw',
      scene: { elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 20, height: 20 },
        { id: 'b', type: 'rectangle', x: 60, y: 0, width: 20, height: 20 },
      ] },
    },
  }, { repository: workspace, now: 100 });
  const grouped = await executeDiagramAgentCommand({ tool: 'group_elements', args: { id: created.id, elementIds: ['a', 'b'], groupId: 'g1', expectedRevision: 1 } }, { repository: workspace, now: 110 });
  assert.equal(grouped.groupId, 'g1');
  const duplicated = await executeDiagramAgentCommand({ tool: 'duplicate_elements', args: { id: created.id, elementIds: ['a', 'b'], expectedRevision: 2 } }, { repository: workspace, now: 120 });
  assert.equal(duplicated.elements.length, 2);
  const snap = await executeDiagramAgentCommand({ tool: 'snapshot_scene', args: { id: created.id, name: 'grouped' } }, { repository: workspace, now: 130 });
  assert.equal(snap.snapshots[0].name, 'grouped');
  const unlocked = await executeDiagramAgentCommand({ tool: 'unlock_elements', args: { id: created.id, elementIds: ['a', 'b'], expectedRevision: 3 } }, { repository: workspace, now: 140 });
  assert.equal(unlocked.revision, 4);
  const restored = await executeDiagramAgentCommand({ tool: 'restore_snapshot', args: { id: created.id, name: 'grouped', expectedRevision: 4 } }, { repository: workspace, now: 150 });
  assert.equal(restored.revision, 5);
  assert.deepEqual(restored.scene.elements.find((item) => item.id === 'a').groupIds, ['g1']);
});

test('batch updates are atomic, idempotent, and can rebase a stale revision', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Batch update',
      engine: 'excalidraw',
      elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 40, height: 20 },
        { id: 'b', type: 'rectangle', x: 80, y: 0, width: 40, height: 20 },
      ],
    },
  }, { repository: workspace, now: 100 });
  const batch = await executeDiagramAgentCommand({
    tool: 'batch_update_elements',
    args: {
      id: created.id,
      expectedRevision: 1,
      operationId: 'batch-1',
      updates: [
        { elementId: 'a', changes: { x: 20 } },
        { id: 'b', changes: { x: 120 } },
      ],
    },
  }, { repository: workspace, now: 110 });
  assert.equal(batch.revision, 2);
  assert.deepEqual(batch.elements.map((element) => element.x), [20, 120]);

  const replay = await executeDiagramAgentCommand({
    tool: 'batch_update_elements',
    args: {
      id: created.id,
      expectedRevision: 1,
      operationId: 'batch-1',
      updates: [
        { elementId: 'a', changes: { x: 20 } },
        { id: 'b', changes: { x: 120 } },
      ],
    },
  }, { repository: workspace, now: 111 });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.operationRevision, 2);
  assert.equal(replay.revision, 2);

  const rebased = await executeDiagramAgentCommand({
    tool: 'apply_diagram_patch',
    args: {
      id: created.id,
      expectedRevision: 1,
      retryOnConflict: true,
      patch: { update: [{ id: 'a', x: 40 }] },
    },
  }, { repository: workspace, now: 120 });
  assert.equal(rebased.revision, 3);
  assert.equal(rebased.conflictRetries, 1);
  assert.equal(rebased.scene.elements.find((element) => element.id === 'b').x, 120);
});

test('MCP projections default to summaries and return full scenes only when requested', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Projected response',
      engine: 'excalidraw',
      elements: [
        { id: 'rect', type: 'rectangle', x: 10, y: 20, width: 100, height: 60 },
        { id: 'label', type: 'text', x: 30, y: 40, width: 40, height: 20, text: 'Hi' },
      ],
      operationId: 'create-projected',
    },
  }, { repository: workspace, now: 100, compactResponse: true });
  assert.equal(created.scene, undefined);
  assert.deepEqual(created.changedIds, ['rect', 'label']);

  const summary = await executeDiagramAgentCommand({
    tool: 'get_diagram', args: { id: created.id },
  }, { repository: workspace, compactResponse: true });
  assert.equal(summary.scene, undefined);
  assert.equal(summary.elementCount, 2);
  assert.deepEqual(summary.typeCounts, { rectangle: 1, text: 1 });
  assert.deepEqual(summary.bounds, { x: 10, y: 20, width: 100, height: 60 });

  const full = await executeDiagramAgentCommand({
    tool: 'get_diagram', args: { id: created.id, projection: 'full' },
  }, { repository: workspace, compactResponse: true });
  assert.equal(full.scene.elements.length, 2);
  assert.ok(Array.isArray(full.revisionHistory));
  assert.equal(typeof full.source, 'string');

  const mutationWithScene = await executeDiagramAgentCommand({
    tool: 'apply_diagram_patch',
    args: {
      id: created.id,
      expectedRevision: 1,
      patch: { update: [{ id: 'rect', x: 20 }] },
      includeScene: true,
    },
  }, { repository: workspace, compactResponse: true, now: 110 });
  assert.equal(mutationWithScene.revision, 2);
  assert.equal(mutationWithScene.scene.elements.find((element) => element.id === 'rect').x, 20);
});

test('large get_diagram scenes stay out of the default MCP response', async (t) => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Large response benchmark',
      engine: 'excalidraw',
      elements: [{ id: 'large-text', type: 'text', x: 0, y: 0, width: 800, height: 400, text: 'x'.repeat(190_000) }],
    },
  }, { repository: workspace, now: 100 });

  const beforeStartedAt = performance.now();
  const full = await executeDiagramAgentCommand({ tool: 'get_diagram', args: { id: created.id } }, { repository: workspace });
  const legacyWire = JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(full, null, 2) }],
    structuredContent: full,
  });
  const beforeMs = performance.now() - beforeStartedAt;

  const afterStartedAt = performance.now();
  const summary = await executeDiagramAgentCommand({ tool: 'get_diagram', args: { id: created.id } }, {
    repository: workspace,
    compactResponse: true,
  });
  const summaryWire = JSON.stringify(createMcpToolResult(summary));
  const afterMs = performance.now() - afterStartedAt;
  const beforeBytes = new TextEncoder().encode(legacyWire).byteLength;
  const afterBytes = new TextEncoder().encode(summaryWire).byteLength;

  assert.ok(beforeBytes > 1_900_000);
  assert.ok(afterBytes < 2_000);
  assert.equal(summary.scene, undefined);
  assert.equal(summary.elementCount, 1);
  t.diagnostic(`get_diagram before=${beforeBytes} bytes/${beforeMs.toFixed(2)}ms after=${afterBytes} bytes/${afterMs.toFixed(2)}ms`);
});

test('batch_create_elements rebases conflicts, replays idempotently, and preserves concurrent browser edits', async () => {
  const base = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: { title: 'Concurrent batch', engine: 'excalidraw', elements: [{ id: 'base', type: 'rectangle', x: 0, y: 0, width: 20, height: 20 }] },
  }, { repository: base, now: 100 });
  let injectBrowserWrite = true;
  const concurrentRepository = {
    drawings: {
      list: (...args) => base.drawings.list(...args),
      get: (...args) => base.drawings.get(...args),
      save: async (nextDrawing, options) => {
        if (injectBrowserWrite && nextDrawing.id === created.id && nextDrawing.revision === 2) {
          injectBrowserWrite = false;
          const current = await base.drawings.get(created.id);
          const currentScene = getDrawingScene(current);
          const browserDrawing = commitDiagramScene(current, {
            ...currentScene,
            elements: [...currentScene.elements, { id: 'browser-edit', type: 'text', x: 40, y: 0, width: 80, height: 20, text: 'browser' }],
          }, { expectedRevision: 1, author: 'user', reason: 'concurrent-browser-edit', now: 105 });
          await base.drawings.save(browserDrawing, { expectedRevision: 1 });
        }
        return base.drawings.save(nextDrawing, options);
      },
    },
  };

  const args = {
    id: created.id,
    expectedRevision: 1,
    retryOnConflict: true,
    maxConflictRetries: 2,
    operationId: 'batch-create-1',
    elements: [
      { id: 'agent-a', type: 'rectangle', x: 140, y: 0, width: 40, height: 20 },
      { id: 'agent-b', type: 'rectangle', x: 200, y: 0, width: 40, height: 20 },
    ],
  };
  const result = await executeDiagramAgentCommand({ tool: 'batch_create_elements', args }, {
    repository: concurrentRepository,
    compactResponse: true,
    now: 110,
  });
  assert.equal(result.revision, 3);
  assert.equal(result.conflictRetries, 1);
  assert.deepEqual(result.changedIds, ['agent-a', 'agent-b']);
  const persistedIds = getDrawingScene(await base.drawings.get(created.id)).elements.map((element) => element.id);
  assert.deepEqual(persistedIds, ['base', 'browser-edit', 'agent-a', 'agent-b']);

  const replay = await executeDiagramAgentCommand({ tool: 'batch_create_elements', args }, {
    repository: concurrentRepository,
    compactResponse: true,
    now: 120,
  });
  assert.equal(replay.revision, 3);
  assert.equal(replay.operationRevision, 3);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(getDrawingScene(await base.drawings.get(created.id)).elements.length, 4);

  const stableReplay = await executeDiagramAgentCommand({
    tool: 'batch_create_elements',
    args: { id: created.id, expectedRevision: 3, elements: args.elements },
  }, { repository: concurrentRepository, compactResponse: true, now: 125 });
  assert.equal(stableReplay.stableIdReplay, true);
  assert.equal(stableReplay.revision, 3);
  assert.equal(getDrawingScene(await base.drawings.get(created.id)).elements.length, 4);

  await assert.rejects(
    executeDiagramAgentCommand({
      tool: 'batch_create_elements',
      args: { ...args, expectedRevision: 3, operationId: 'batch-create-collision', elements: [{ id: 'agent-a', type: 'ellipse' }] },
    }, { repository: concurrentRepository, compactResponse: true, now: 130 }),
    (error) => error.code === 'ELEMENT_ID_COLLISION' && error.elementIds[0] === 'agent-a',
  );

  const alwaysConflicting = {
    drawings: {
      list: (...readArgs) => base.drawings.list(...readArgs),
      get: (...readArgs) => base.drawings.get(...readArgs),
      save: async () => {
        const error = new Error('forced conflict');
        error.code = 'REVISION_CONFLICT';
        error.actualRevision = 3;
        throw error;
      },
    },
  };
  await assert.rejects(
    executeDiagramAgentCommand({
      tool: 'batch_create_elements',
      args: {
        id: created.id,
        expectedRevision: 3,
        retryOnConflict: true,
        maxConflictRetries: 1,
        operationId: 'batch-create-exhausted',
        elements: [{ id: 'never-written', type: 'rectangle' }],
      },
    }, { repository: alwaysConflicting, compactResponse: true, now: 140 }),
    (error) => error.code === 'REVISION_CONFLICT' && error.retryExhausted === true && error.conflictRetries === 1,
  );
});

test('browser command metrics expose repository timings and payload sizes', async () => {
  const workspace = repository();
  const result = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: { title: 'Metrics', engine: 'excalidraw', scene: { elements: [] }, open: false },
  }, { repository: workspace, includeMetrics: true, now: 200 });
  assert.equal(result.operationMetrics.operation, 'create_diagram');
  assert.equal(result.operationMetrics.transport, 'browser');
  assert.ok(result.operationMetrics.requestBytes > 0);
  assert.ok(result.operationMetrics.responseBytes > 0);
  assert.ok(Number.isFinite(result.operationMetrics.browserExecutionMs));
  assert.ok(Number.isFinite(result.operationMetrics.repositoryReadMs));
  assert.ok(Number.isFinite(result.operationMetrics.repositoryWriteMs));
});

test('mcp_excalidraw aliases preserve revision locking and Mermaid persistence', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: {
      title: 'Layout aliases',
      engine: 'excalidraw',
      scene: { elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 10, width: 20, height: 10 },
        { id: 'b', type: 'rectangle', x: 50, y: 40, width: 10, height: 10 },
        { id: 'c', type: 'rectangle', x: 140, y: 80, width: 20, height: 10 },
      ] },
    },
  }, { repository: workspace, now: 100 });

  const aligned = await executeDiagramAgentCommand({
    tool: 'align_elements',
    args: { id: created.id, elementIds: ['a', 'b', 'c'], alignment: 'top', expectedRevision: 1 },
  }, { repository: workspace, now: 110 });
  assert.equal(aligned.revision, 2);
  assert.deepEqual(aligned.scene.elements.map((element) => element.y), [10, 10, 10]);
  assert.equal(aligned.nextAction, 'describe_scene_then_get_canvas_screenshot');

  const distributed = await executeDiagramAgentCommand({
    tool: 'distribute_elements',
    args: { id: created.id, elementIds: ['a', 'b', 'c'], direction: 'horizontal', expectedRevision: 2 },
  }, { repository: workspace, now: 120 });
  assert.equal(distributed.revision, 3);
  assert.deepEqual(distributed.scene.elements.map((element) => element.x), [0, 75, 140]);

  await assert.rejects(
    executeDiagramAgentCommand({
      tool: 'align_elements',
      args: { id: created.id, elementIds: ['a', 'b'], alignment: 'left', expectedRevision: 2 },
    }, { repository: workspace, now: 130 }),
    (error) => error.code === 'REVISION_CONFLICT',
  );

  const mermaid = await executeDiagramAgentCommand({
    tool: 'create_from_mermaid',
    args: { title: 'Mermaid alias', mermaidDiagram: 'flowchart LR\nA-->B', open: false },
  }, { repository: workspace, now: 140 });
  assert.equal(mermaid.engine, 'mermaid');
  assert.equal(mermaid.source, 'flowchart LR\nA-->B');
  assert.equal(mermaid.openRequested, false);
  assert.equal((await workspace.drawings.list()).length, 2);

  const description = await executeDiagramAgentCommand({
    tool: 'describe_scene',
    args: { id: created.id },
  }, { repository: workspace });
  assert.match(description, /Total elements: 3/);
});

test('persists presentation steps separately from scene revisions and emits playback controls', async () => {
  const workspace = repository();
  const created = await executeDiagramAgentCommand({
    tool: 'create_diagram',
    args: { title: 'Presentation', engine: 'excalidraw', scene: { elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 20, height: 20 }] } },
  }, { repository: workspace, now: 100 });
  const events = [];
  const presentation = await executeDiagramAgentCommand({
    tool: 'set_presentation',
    args: {
      id: created.id,
      presentation: { title: 'A to B', steps: [{ id: 'a', title: 'A', visibleElementIds: ['a'], focusElementIds: ['a'], durationMs: 20 }] },
    },
  }, { repository: workspace, onPresentation: (event) => events.push(event), now: 200 });
  assert.equal(presentation.revision, 1);
  assert.equal(presentation.presentation.steps[0].visibleElementIds[0], 'a');
  const read = await executeDiagramAgentCommand({ tool: 'get_presentation', args: { id: created.id } }, { repository: workspace });
  assert.equal(read.presentation.title, 'A to B');
  const played = await executeDiagramAgentCommand({ tool: 'play_presentation', args: { id: created.id, stepIndex: 0 } }, { repository: workspace, onPresentation: (event) => events.push(event) });
  assert.equal(played.action, 'play');
  assert.deepEqual(events.map((event) => event.action), ['play']);
  const stored = (await workspace.drawings.list())[0];
  assert.equal(stored.revision, 1);
});
