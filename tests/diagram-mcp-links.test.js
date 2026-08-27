import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagramUrl,
  buildDiagramWorkspaceUrl,
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
  assert.match(recovery.content[0].text, /open_diagram_workspace_then_retry/);
  assert.equal(createMcpBrowserRecoveryResult(new Error('bad request')), null);
});
