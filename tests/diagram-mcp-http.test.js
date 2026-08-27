import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMcpSessionCount,
  handleDiagramMcpHttpRequest,
} from '../lib/diagram-mcp-http.js';
import {
  getDiagramMcpPairingStore,
  resetDiagramMcpPairingStoreForTests,
} from '../lib/diagram-mcp-pairing-store.js';
import { DIAGRAM_MCP_APP_RESOURCE_URI, DIAGRAM_MCP_APP_MIME_TYPE } from '../lib/diagram-mcp-app-resource.js';

function request(url, body, headers = {}, method = 'POST') {
  return new Request(url, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('Streamable HTTP MCP initializes, lists tools and calls a browser command', async () => {
  const previousKey = process.env.ANCHORREAD_MCP_API_KEY;
  delete process.env.ANCHORREAD_MCP_API_KEY;
  try {
    const initialize = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    }));
    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers.get('mcp-session-id');
    assert.match(sessionId, /^anchorread-/);
    const initializeResult = (await initialize.json()).result;
    assert.equal(initializeResult.protocolVersion, '2025-06-18');
    assert.deepEqual(initializeResult.capabilities.resources, {});

    const listed = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    }, { 'MCP-Session-Id': sessionId }));
    const tools = (await listed.json()).result.tools;
    const createTool = tools.find((tool) => tool.name === 'create_diagram');
    assert.ok(createTool);
    assert.equal(createTool._meta.ui.resourceUri, DIAGRAM_MCP_APP_RESOURCE_URI);
    assert.equal(tools.some((tool) => tool.name === 'export_excalidraw'), false);

    const resources = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 20, method: 'resources/list', params: {},
    }, { 'MCP-Session-Id': sessionId }));
    const resourceListing = (await resources.json()).result.resources[0];
    assert.equal(resourceListing.uri, DIAGRAM_MCP_APP_RESOURCE_URI);
    assert.equal(resourceListing.mimeType, DIAGRAM_MCP_APP_MIME_TYPE);

    const resourceRead = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 21, method: 'resources/read', params: { uri: DIAGRAM_MCP_APP_RESOURCE_URI },
    }, { 'MCP-Session-Id': sessionId }));
    const resource = (await resourceRead.json()).result.contents[0];
    assert.equal(resource.mimeType, DIAGRAM_MCP_APP_MIME_TYPE);
    assert.match(resource.text, /@modelcontextprotocol\/ext-apps@1\.7\.5/);
    assert.match(resource.text, /app\.connect\(\)/);

    let submitted;
    const called = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
        name: 'create_diagram', arguments: { title: 'Remote concept', engine: 'mermaid' },
      },
    }, { 'MCP-Session-Id': sessionId }), {
      submitTool: async (name, args) => {
        submitted = { name, args };
        return {
          id: 'dg-test1234',
          routeId: 'dg-test1234',
          title: args.title,
          url: 'https://anchorread.flowguide.cc/diagrams/dg-test1234',
          openResource: {
            kind: 'diagram',
            routeId: 'dg-test1234',
            title: args.title,
            url: 'https://anchorread.flowguide.cc/diagrams/dg-test1234',
          },
        };
      },
    });
    const result = await called.json();
    assert.equal(result.result.isError, undefined);
    assert.match(result.result.content[0].text, /dg-test1234/);
    assert.equal(result.result.content[1].type, 'resource_link');
    assert.equal(result.result.content[1].uri, 'https://anchorread.flowguide.cc/diagrams/dg-test1234');
    assert.deepEqual(submitted, {
      name: 'create_diagram',
      args: { title: 'Remote concept', engine: 'mermaid' },
    });

    const workspace = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
        name: 'open_diagram_workspace', arguments: {},
      },
    }, { 'MCP-Session-Id': sessionId }), {
      submitTool: async () => { throw new Error('workspace link must not wait for the browser bridge'); },
    });
    const workspaceResult = await workspace.json();
    assert.equal(workspaceResult.result.content[1].type, 'resource_link');
    assert.match(workspaceResult.result.content[1].uri, /\/diagrams$/);

    const offline = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
        name: 'create_diagram', arguments: { title: 'Needs browser' },
      },
    }, { 'MCP-Session-Id': sessionId }), {
      submitTool: async () => {
        throw Object.assign(new Error('No AnchorRead browser is connected.'), { code: 'BRIDGE_TIMEOUT' });
      },
    });
    const offlineResult = await offline.json();
    assert.equal(offlineResult.result.isError, true);
    assert.match(offlineResult.result.content[0].text, /open_diagram_workspace_then_retry/);
    assert.equal(offlineResult.result.content[1].type, 'resource_link');
    assert.match(offlineResult.result.content[1].uri, /\/diagrams$/);

    const closed = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', undefined, {
      'MCP-Session-Id': sessionId,
    }, 'DELETE'));
    assert.equal(closed.status, 204);
  } finally {
    if (previousKey === undefined) delete process.env.ANCHORREAD_MCP_API_KEY;
    else process.env.ANCHORREAD_MCP_API_KEY = previousKey;
  }
});

test('remote MCP requires a paired token, binds the session, and enforces CORS origins', async () => {
  const previousOrigins = process.env.ANCHORREAD_MCP_ALLOWED_ORIGINS;
  const previousStore = process.env.ANCHORREAD_MCP_PAIRING_STORE;
  process.env.ANCHORREAD_MCP_ALLOWED_ORIGINS = 'https://client.example';
  process.env.ANCHORREAD_MCP_PAIRING_STORE = 'memory';
  resetDiagramMcpPairingStoreForTests();
  const store = getDiagramMcpPairingStore();
  const browser = {
    workspaceId: 'workspace-http',
    browserSessionId: 'session-http',
    tabId: 'tab-http',
    clientId: 'client-http',
    managementSecret: 'manage-http-secret',
  };
  try {
    await store.registerConnection(browser);
    const created = await store.createToken(browser, { name: 'HTTP test' });
    const reopenedBrowser = {
      ...browser,
      browserSessionId: 'session-http-reopened',
      tabId: 'tab-http-reopened',
      clientId: 'client-http-reopened',
    };
    await store.registerConnection(reopenedBrowser, { replace: true });
    const authorization = `Bearer ${created.token}`;
    const denied = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
    }, { Origin: 'https://client.example' }));
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('www-authenticate'), 'Bearer resource_metadata="https://anchor.example/.well-known/oauth-protected-resource/mcp"');

    const accepted = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 2, method: 'initialize', params: {},
    }, { Origin: 'https://client.example', Authorization: authorization }));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get('access-control-allow-origin'), 'https://client.example');
    assert.equal(accepted.headers.get('x-anchorread-routing-mode'), 'single-process-memory');
    const sessionId = accepted.headers.get('mcp-session-id');

    let submittedOptions;
    const called = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_diagrams', arguments: {} },
    }, { Origin: 'https://client.example', Authorization: authorization, 'MCP-Session-Id': sessionId }), {
      submitTool: async (_name, _args, options) => {
        submittedOptions = options;
        return [];
      },
    });
    assert.equal(called.status, 200);
    assert.equal(submittedOptions.binding.workspaceId, browser.workspaceId);
    assert.equal(submittedOptions.binding.browserSessionId, reopenedBrowser.browserSessionId);
    assert.equal(submittedOptions.tokenId, created.record.id);

    const blockedOrigin = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 4, method: 'initialize', params: {},
    }, { Origin: 'https://evil.example', Authorization: authorization }));
    assert.equal(blockedOrigin.status, 403);

    await store.revokeToken(reopenedBrowser, created.record.id);
    const revoked = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 5, method: 'ping', params: {},
    }, { Origin: 'https://client.example', Authorization: authorization, 'MCP-Session-Id': sessionId }));
    assert.equal(revoked.status, 401);
  } finally {
    if (previousOrigins === undefined) delete process.env.ANCHORREAD_MCP_ALLOWED_ORIGINS;
    else process.env.ANCHORREAD_MCP_ALLOWED_ORIGINS = previousOrigins;
    if (previousStore === undefined) delete process.env.ANCHORREAD_MCP_PAIRING_STORE;
    else process.env.ANCHORREAD_MCP_PAIRING_STORE = previousStore;
    resetDiagramMcpPairingStoreForTests();
  }
});

test('MCP sessions reject tool calls before initialize and expire by explicit delete', async () => {
  const before = getMcpSessionCount();
  const response = await handleDiagramMcpHttpRequest(request('http://localhost:3000/mcp', {
    jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
  }));
  assert.equal(response.status, 400);
  assert.equal(getMcpSessionCount(), before);
});
