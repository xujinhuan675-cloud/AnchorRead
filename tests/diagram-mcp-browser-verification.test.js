import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDiagramBrowserConnection } from '../lib/diagram-mcp-browser-verification.js';
import { handleDiagramMcpHttpRequest } from '../lib/diagram-mcp-http.js';

function rpcRequest(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('browser verification reports a successful IndexedDB round trip', async () => {
  const request = new Request('https://0.0.0.0:3000/mcp', {
    headers: {
      'x-forwarded-host': 'anchorread.flowguide.cc',
      'x-forwarded-proto': 'https',
    },
  });
  const result = await verifyDiagramBrowserConnection({
    request,
    auth: {
      local: false,
      token: { id: 'token-test' },
      binding: { workspaceId: 'workspace-test', browserSessionId: 'session-test', tabId: 'tab-test', connected: true },
    },
    submitTool: async (name) => {
      assert.equal(name, 'list_diagrams');
      return [{ id: 'one' }, { id: 'two' }];
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.workspaceUrl, 'https://anchorread.flowguide.cc/diagrams');
  assert.equal(result.diagramCount, 2);
  assert.deepEqual(Object.values(result.checks).map((item) => item.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
  assert.equal(result.nextAction, 'none');
});

test('browser verification explains an offline OAuth workspace without attempting storage', async () => {
  let submitted = false;
  const result = await verifyDiagramBrowserConnection({
    request: new Request('https://anchorread.flowguide.cc/mcp'),
    auth: {
      local: false,
      token: { id: 'token-test' },
      binding: { workspaceId: 'workspace-test', connected: false },
    },
    submitTool: async () => { submitted = true; },
  });
  assert.equal(submitted, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BROWSER_SESSION_OFFLINE');
  assert.equal(result.checks.mcpOAuth.status, 'PASS');
  assert.equal(result.checks.browserSessionOnline.status, 'FAIL');
  assert.equal(result.nextAction, 'open_workspace_then_retry');
  assert.equal(result.nextActionDetails.ifStillOffline.command, 'codex mcp login anchorread');
});

test('Streamable HTTP exposes and executes verify_browser_connection', async () => {
  const initialize = await handleDiagramMcpHttpRequest(rpcRequest('http://127.0.0.1:3000/mcp', {
    jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
  }));
  const sessionId = initialize.headers.get('mcp-session-id');
  const listed = await handleDiagramMcpHttpRequest(rpcRequest('http://127.0.0.1:3000/mcp', {
    jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
  }, { 'MCP-Session-Id': sessionId }));
  const tools = (await listed.json()).result.tools;
  assert.equal(tools.find((tool) => tool.name === 'verify_browser_connection')?.annotations?.readOnlyHint, true);

  const verified = await handleDiagramMcpHttpRequest(rpcRequest('http://127.0.0.1:3000/mcp', {
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'verify_browser_connection', arguments: {} },
  }, { 'MCP-Session-Id': sessionId }), {
    submitTool: async () => [],
  });
  const result = (await verified.json()).result;
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.diagramCount, 0);
});
