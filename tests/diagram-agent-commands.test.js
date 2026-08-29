import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryWorkspaceAdapter, createWorkspaceRepository } from '../lib/local-workspace-db.js';
import { executeDiagramAgentCommand } from '../lib/diagram-agent-commands.js';
import { STANDALONE_DIAGRAM_DOCUMENT_ID } from '../lib/diagram-generation.js';

function repository() {
  return createWorkspaceRepository(createMemoryWorkspaceAdapter());
}

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
  assert.equal(created.openAction, 'navigate_current_tab');
  assert.equal(created.openResource.kind, 'diagram');
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
