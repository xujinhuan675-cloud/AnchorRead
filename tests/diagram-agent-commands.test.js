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
