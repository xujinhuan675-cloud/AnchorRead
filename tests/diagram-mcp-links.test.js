import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagramUrl,
  buildDiagramWorkspaceUrl,
  createInlineViewResult,
  createInlineViewToolResult,
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
  assert.equal(result.structuredContent.openResource.kind, 'diagram');
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

test('workspace links never expose an internal container bind address', () => {
  assert.equal(
    buildDiagramWorkspaceUrl({ baseUrl: 'https://0.0.0.0:3000/mcp' }),
    'https://anchorread.flowguide.cc/diagrams',
  );
  assert.equal(buildDiagramWorkspaceUrl({ baseUrl: 'http://[::]:3000/mcp' }), 'https://anchorread.flowguide.cc/diagrams');
});

test('inline view tool results expose a structured Excalidraw payload', () => {
  const result = createInlineViewToolResult({
    elements: JSON.stringify([{ id: 'structured-rect', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }]),
  });
  assert.equal(result.content[0].type, 'text');
  assert.equal(result.structuredContent.engine, 'excalidraw');
  assert.equal(result.structuredContent.scene.elements[0].id, 'structured-rect');
});

test('text-wrapped object results retain structured content for MCP Apps', () => {
  const metadata = createMcpToolResult({ title: 'Metadata only' });
  assert.equal(metadata.structuredContent.title, 'Metadata only');
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

});
