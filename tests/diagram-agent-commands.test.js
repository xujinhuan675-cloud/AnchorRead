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
  assert.equal(opened.id, created.id);
  assert.equal((await workspace.drawings.list()).length, 1);

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

