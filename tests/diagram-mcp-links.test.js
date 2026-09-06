import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagramUrl,
  buildDiagramWakeUrl,
  buildDiagramWorkspaceUrl,
  createInlineDiagramResult,
  createInlineViewResult,
  createInlineViewToolResult,
  createDeferredDiagramResult,
  createMcpBrowserRecoveryResult,
  createMcpToolResult,
} from '../lib/diagram-mcp-links.js';

test('diagram links use a stable public origin and encode route ids', () => {
  assert.equal(
    buildDiagramUrl('dg/a b', { baseUrl: 'https://anchorread.example/some/path' }),
    'https://anchorread.example/diagrams/dg%2Fa%20b',
  );
  assert.equal(
    buildDiagramWorkspaceUrl({ baseUrl: 'https://anchorread.example/mcp' }),
    'https://anchorread.example/diagrams',
  );
});

test('MCP result adds a standard resource link for openable resources', () => {
  const result = createMcpToolResult({
    routeId: 'dg-1234',
    openResource: {
      kind: 'diagram',
      routeId: 'dg-1234',
      title: 'Architecture',
      url: 'https://anchorread.example/diagrams/dg-1234',
    },
  });

  assert.equal(result.content[0].type, 'text');
  assert.equal(result.content[1].type, 'resource_link');
  assert.equal(result.content[1].uri, 'https://anchorread.example/diagrams/dg-1234');
});

test('browser recovery result adds a workspace link only for browser-unavailable errors', () => {
  const recovery = createMcpBrowserRecoveryResult(
    Object.assign(new Error('Open AnchorRead and retry.'), { code: 'BROWSER_SESSION_OFFLINE' }),
    { baseUrl: 'https://anchorread.example/mcp' },
  );
  assert.equal(recovery.content[1].type, 'resource_link');
  assert.equal(recovery.content[1].uri, 'https://anchorread.example/diagrams');
  assert.equal(recovery.structuredContent.url, 'https://anchorread.example/diagrams');
  assert.equal(recovery.structuredContent.openRequested, true);
  assert.equal(recovery.structuredContent.openTarget, 'default_browser');
  assert.match(recovery.content[0].text, /open_diagram_workspace_then_retry/);
  assert.equal(createMcpBrowserRecoveryResult(new Error('bad request')), null);
});

test('inline MCP results retain scene content without a browser bridge', () => {
  const result = createInlineViewResult({
    elements: JSON.stringify([{ id: 'rect-1', type: 'rectangle', x: 10, y: 20, width: 120, height: 60 }]),
  });
  assert.equal(result.engine, 'excalidraw');
  assert.equal(result.scene.elements[0].id, 'rect-1');
  const mermaid = createInlineDiagramResult({ title: 'Flow', engine: 'mermaid', source: 'flowchart TD\nA-->B' });
  assert.equal(mermaid.source, 'flowchart TD\nA-->B');
  assert.equal(mermaid.presentation.steps.length, 2);
  assert.deepEqual(mermaid.presentation.steps[1].focusElementIds, ['mermaid-2']);
  const inferredExcalidraw = createInlineDiagramResult({ title: 'Nodes', elements: [{ id: 'node-1', type: 'rectangle', x: 0, y: 0, width: 20, height: 20 }] });
  assert.equal(inferredExcalidraw.engine, 'excalidraw');
  assert.equal(inferredExcalidraw.presentation.steps.length, 1);
  assert.deepEqual(inferredExcalidraw.presentation.steps[0].focusElementIds, ['node-1']);
  assert.equal(createInlineDiagramResult({ title: 'Empty', engine: 'mermaid' }), null);
});

test('deferred diagram links wake the default browser without carrying scene data in the URL', () => {
  assert.equal(
    buildDiagramWakeUrl('request id', { baseUrl: 'https://anchorread.example/mcp' }),
    'https://anchorread.example/diagrams?diagramWake=request%20id',
  );
  const deferred = createDeferredDiagramResult({
    title: 'Local-only',
    engine: 'excalidraw',
    elements: [{ id: 'local-node', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }],
  }, 'wake-123', { baseUrl: 'https://anchorread.example/mcp' });
  assert.equal(deferred.queued, true);
  assert.equal(deferred.openTarget, 'default_browser');
  assert.equal(deferred.url, 'https://anchorread.example/diagrams?diagramWake=wake-123');
  assert.doesNotMatch(deferred.url, /local-node/u);
});

test('workspace links never expose an internal container bind address', () => {
  assert.equal(
    buildDiagramWorkspaceUrl({ baseUrl: 'https://0.0.0.0:3000/mcp' }),
    'https://anchorread.flowguide.cc/diagrams',
  );
  assert.equal(
    buildDiagramWakeUrl('wake-123', { baseUrl: 'http://[::]:3000/mcp' }),
    'https://anchorread.flowguide.cc/diagrams?diagramWake=wake-123',
  );
});

test('inline view tool results expose a structured Excalidraw payload', () => {
  const result = createInlineViewToolResult({
    elements: JSON.stringify([{ id: 'structured-rect', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }]),
  });
  assert.equal(result.content[0].type, 'text');
  assert.equal(result.structuredContent.engine, 'excalidraw');
  assert.equal(result.structuredContent.scene.elements[0].id, 'structured-rect');
});

test('inline diagram payloads preserve named phase focus and camera steps', () => {
  const presentation = {
    title: '四阶段演示',
    steps: [{
      id: 'analysis',
      title: '需求分析',
      visibleElementIds: ['a'],
      focusElementIds: ['a'],
      highlightElementIds: ['a'],
      camera: { region: { x: 0, y: 0, width: 240, height: 120 } },
      durationMs: 800,
      transitionMs: 300,
    }],
  };
  const result = createInlineViewResult({
    elements: JSON.stringify([{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 120, height: 60 }]),
    presentation,
  });
  assert.equal(result.presentation.title, '四阶段演示');
  assert.equal(result.presentation.steps[0].title, '需求分析');
  assert.deepEqual(result.presentation.steps[0].focusElementIds, ['a']);
  assert.equal(result.presentation.steps[0].camera.region.width, 240);

  const offline = createInlineDiagramResult({
    title: 'Flow',
    engine: 'mermaid',
    source: 'flowchart TD\nA-->B',
    presentation,
  });
  assert.equal(offline.presentation.steps[0].title, '需求分析');
  assert.equal(offline.presentation.steps[0].transitionMs, 300);
});
