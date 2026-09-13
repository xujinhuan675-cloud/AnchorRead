import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMcpSession,
  getMcpSessionCount,
  handleDiagramMcpHttpRequest,
  submitDiagramTool,
} from '../lib/diagram-mcp-http.js';
import {
  getDiagramMcpPairingStore,
  resetDiagramMcpPairingStoreForTests,
} from '../lib/diagram-mcp-pairing-store.js';
import { DIAGRAM_MCP_APP_RESOURCE_URI, DIAGRAM_MCP_APP_MIME_TYPE } from '../lib/diagram-mcp-app-resource.js';
import {
  claimDiagramAgentRequests,
  resetDiagramAgentBrokerForTests,
  resolveDiagramAgentRequest,
} from '../lib/diagram-agent-broker.js';
import { getDiagramAgentBuildInfo } from '../lib/diagram-agent-protocol.js';
import {
  resetDiagramAgentTransportForTests,
  setDiagramAgentTransport,
} from '../lib/diagram-agent-transport.js';

function request(url, body, headers = {}, method = 'POST') {
  return new Request(url, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('scoped MCP commands fail fast when no browser presence is available', async () => {
  setDiagramAgentTransport({
    createRequest() { throw new Error('createRequest must not run'); },
    cancelRequest() {},
    cancelRequestsForToken() {},
    claimRequests() { return []; },
    waitForRequests() { return []; },
    resolveRequest() { return false; },
    registerClient() {},
    unregisterClient() {},
    getPresence: async () => null,
  });
  const startedAt = Date.now();
  try {
    await assert.rejects(
      submitDiagramTool('list_diagrams', {}, {
        binding: { workspaceId: 'workspace-fast-fail', bindingId: 'binding-fast-fail' },
      }),
      (error) => error?.code === 'BROWSER_SESSION_OFFLINE',
    );
  } finally {
    resetDiagramAgentTransportForTests();
  }
  assert.ok(Date.now() - startedAt < 1_000);
});

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
    assert.match(initializeResult.instructions, /source -> target -> connector/);

    const listed = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    }, { 'MCP-Session-Id': sessionId }));
    const tools = (await listed.json()).result.tools;
    const createTool = tools.find((tool) => tool.name === 'create_diagram');
    const createViewTool = tools.find((tool) => tool.name === 'create_view');
    assert.ok(createTool);
    assert.match(createViewTool.description, /起点节点.*终点节点.*连线及关系文字/);
    assert.equal(createTool._meta.ui.resourceUri, DIAGRAM_MCP_APP_RESOURCE_URI);
    assert.equal(tools.some((tool) => tool.name === 'export_excalidraw'), false);
    assert.ok(tools.some((tool) => tool.name === 'read_diagram_guide'));
    assert.ok(tools.some((tool) => tool.name === 'describe_scene'));
    assert.ok(tools.some((tool) => tool.name === 'preflight_scene'));
    assert.ok(tools.some((tool) => tool.name === 'verify_diagram'));
    const guide = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 19, method: 'tools/call', params: {
        name: 'read_diagram_guide', arguments: {},
      },
    }, { 'MCP-Session-Id': sessionId }), {
      submitTool: async () => { throw new Error('read_diagram_guide must not wait for the browser bridge'); },
    });
    const guideResult = await guide.json();
    assert.equal(guideResult.result.isError, undefined);
    assert.match(guideResult.result.content[0].text, /Required workflow/);

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
    assert.match(resource.text, /@modelcontextprotocol\/ext-apps@0\.4\.0\/react/);
    assert.match(resource.text, /useApp\(/);

    const inline = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 22, method: 'tools/call', params: {
        name: 'create_view', arguments: {
          elements: JSON.stringify([{ id: 'inline-rect', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }]),
        },
      },
    }, { 'MCP-Session-Id': sessionId }), {
      submitTool: async () => { throw new Error('create_view must not wait for the browser bridge'); },
    });
    const inlineResult = await inline.json();
    assert.equal(inlineResult.result.isError, undefined);
    assert.match(inlineResult.result.content[0].text, /inline-rect/);
    assert.equal(inlineResult.result.structuredContent.engine, 'excalidraw');
    assert.equal(inlineResult.result.structuredContent.scene.elements[0].id, 'inline-rect');

    const statelessInline = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 23, method: 'tools/call', params: {
        name: 'create_view', arguments: {
          elements: JSON.stringify([{ id: 'stateless-inline-rect', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }]),
        },
      },
    }));
    const statelessResult = await statelessInline.json();
    assert.equal(statelessInline.status, 200);
    assert.equal(statelessResult.result.structuredContent.scene.elements[0].id, 'stateless-inline-rect');

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
    assert.equal(workspaceResult.result.structuredContent.openRequested, true);
    assert.match(workspaceResult.result.structuredContent.openResource.url, /\/diagrams$/);

    const readiness = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 23, method: 'tools/call', params: {
        name: 'ensure_workspace_ready', arguments: {},
      },
    }, { 'MCP-Session-Id': sessionId }), {
      submitTool: async () => { throw new Error('readiness must not wait for the browser bridge'); },
    });
    const readinessResult = await readiness.json();
    assert.equal(readinessResult.result.structuredContent.mode, 'local_http');
    assert.equal(readinessResult.result.structuredContent.ready, true);
    assert.equal(readinessResult.result.structuredContent.nextAction, 'continue_persisted_diagram_workflow');
    assert.equal(readinessResult.result.content[1].type, 'resource_link');

    const contentfulOffline = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 24, method: 'tools/call', params: {
        name: 'create_diagram', arguments: {
          title: 'Offline content',
          engine: 'excalidraw',
          elements: [{ id: 'offline-rect', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }],
        },
      },
    }, { 'MCP-Session-Id': sessionId }), {
      submitTool: async () => {
        throw Object.assign(new Error('No AnchorRead browser is connected.'), { code: 'BRIDGE_TIMEOUT' });
      },
    });
    const contentfulOfflineResult = await contentfulOffline.json();
    assert.equal(contentfulOfflineResult.result.isError, true);
    assert.equal(contentfulOfflineResult.result.structuredContent.code, 'BRIDGE_TIMEOUT');
    assert.equal(contentfulOfflineResult.result.structuredContent.nextAction, 'open_diagram_workspace_then_retry');
    assert.equal(contentfulOfflineResult.result.structuredContent.scene, undefined);
    assert.equal(contentfulOfflineResult.result.content[1].type, 'resource_link');

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
    assert.equal(offlineResult.result.structuredContent.openRequested, true);
    assert.match(offlineResult.result.structuredContent.url, /\/diagrams$/);

    const closed = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', undefined, {
      'MCP-Session-Id': sessionId,
    }, 'DELETE'));
    assert.equal(closed.status, 204);
  } finally {
    if (previousKey === undefined) delete process.env.ANCHORREAD_MCP_API_KEY;
    else process.env.ANCHORREAD_MCP_API_KEY = previousKey;
  }
});

test('create_diagram returns only after the browser acknowledges persistence', async () => {
  resetDiagramAgentBrokerForTests();
  try {
    const initialize = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 70, method: 'initialize', params: {},
    }));
    const sessionId = initialize.headers.get('mcp-session-id');
    const created = handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
      jsonrpc: '2.0', id: 71, method: 'tools/call', params: {
        name: 'create_diagram',
        arguments: {
          title: 'Default browser wake',
          engine: 'excalidraw',
          elements: [{ id: 'wake-node', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }],
        },
      },
    }, { 'MCP-Session-Id': sessionId }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const claimed = claimDiagramAgentRequests('connected-browser', {
      client: { workspaceId: '', visible: true, focused: true, ...getDiagramAgentBuildInfo() },
    });
    assert.equal(claimed[0].payload.args.elements[0].id, 'wake-node');
    resolveDiagramAgentRequest(claimed[0].id, claimed[0].claimToken, {
      id: 'drawing-ack', routeId: 'dg-ack', revision: 1,
    });
    const result = (await (await created).json()).result.structuredContent;
    assert.equal(result.id, 'drawing-ack');
    assert.equal(result.routeId, 'dg-ack');
    assert.equal(result.revision, 1);
    assert.equal(result.queued, undefined);
  } finally {
    resetDiagramAgentBrokerForTests();
  }
});

test('revision conflicts retain structured retry exhaustion details', async () => {
  const initialize = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
    jsonrpc: '2.0', id: 72, method: 'initialize', params: {},
  }));
  const sessionId = initialize.headers.get('mcp-session-id');
  const response = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
    jsonrpc: '2.0', id: 73, method: 'tools/call', params: {
      name: 'batch_create_elements',
      arguments: { id: 'conflicted', elements: [{ id: 'a', type: 'rectangle' }], retryOnConflict: true },
    },
  }, { 'MCP-Session-Id': sessionId }), {
    submitTool: async () => {
      const error = new Error('Diagram revision conflict after retry.');
      error.code = 'REVISION_CONFLICT';
      error.expectedRevision = 2;
      error.actualRevision = 3;
      error.retryExhausted = true;
      error.conflictRetries = 2;
      error.maxConflictRetries = 2;
      throw error;
    },
  });
  const result = (await response.json()).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, 'REVISION_CONFLICT');
  assert.equal(result.structuredContent.retryExhausted, true);
  assert.equal(result.structuredContent.actualRevision, 3);
});

test('Streamable HTTP keeps SSE alive and rebuilds a stale POST session', async () => {
  const initialize = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
    jsonrpc: '2.0', id: 31, method: 'initialize', params: {},
  }));
  const sessionId = initialize.headers.get('mcp-session-id');
  const streamResponse = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', undefined, {
    Accept: 'text/event-stream',
    'MCP-Session-Id': sessionId,
  }, 'GET'));
  assert.equal(streamResponse.status, 200);
  assert.equal(streamResponse.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = streamResponse.body.getReader();
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  assert.match(new TextDecoder().decode(firstChunk.value), /stream connected/);
  await reader.cancel();

  const expired = await handleDiagramMcpHttpRequest(request('http://127.0.0.1:3000/mcp', {
    jsonrpc: '2.0', id: 32, method: 'ping', params: {},
  }, { 'MCP-Session-Id': 'anchorread-expired-session' }));
  assert.equal(expired.status, 200);
  assert.equal(expired.headers.get('mcp-session-id'), 'anchorread-expired-session');
  assert.deepEqual((await expired.json()).result, {});
});

test('remote MCP requires OAuth, follows the active browser tab, and enforces CORS origins', async () => {
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
    const registered = await store.registerConnection(browser);
    const created = await store.createTokenForWorkspace(registered, { name: 'OAuth HTTP test', expiresInMs: 60_000 });
    const reopenedBrowser = {
      ...browser,
      tabId: 'tab-http-reopened',
      clientId: 'client-http-reopened',
    };
    const reconnected = await store.registerConnection(reopenedBrowser, { replace: true });
    assert.equal(reconnected.bindingId, registered.bindingId);
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
    assert.equal(submittedOptions.binding.bindingId, registered.bindingId);
    assert.equal(submittedOptions.tokenId, created.record.id);

    // OAuth refresh/re-login may produce a new token while the client keeps
    // sending the old MCP-Session-Id. The stable browser binding keeps the
    // session valid while the request uses the new token.
    const rotated = await store.createTokenForWorkspace(registered, { name: 'OAuth HTTP refresh', expiresInMs: 60_000 });
    let reboundSubmission;
    const rebound = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'list_diagrams', arguments: {} },
    }, { Origin: 'https://client.example', Authorization: `Bearer ${rotated.token}`, 'MCP-Session-Id': sessionId }), {
      submitTool: async (_name, _args, options) => {
        reboundSubmission = options;
        return [];
      },
    });
    assert.equal(rebound.status, 200);
    assert.equal(rebound.headers.get('mcp-session-id'), sessionId);
    assert.equal(reboundSubmission.tokenId, rotated.record.id);
    assert.equal(reboundSubmission.binding.workspaceId, browser.workspaceId);

    const legacySession = createMcpSession({
      protocolVersion: '2025-06-18',
      auth: {
        tokenId: created.record.id,
        workspaceId: browser.workspaceId,
        browserSessionId: browser.browserSessionId,
      },
    });
    const legacyRebound = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 32, method: 'ping', params: {},
    }, { Origin: 'https://client.example', Authorization: `Bearer ${rotated.token}`, 'MCP-Session-Id': legacySession.id }));
    assert.equal(legacyRebound.status, 200);
    assert.equal(legacyRebound.headers.get('mcp-session-id'), legacySession.id);

    const otherBrowser = {
      workspaceId: 'workspace-http-other',
      browserSessionId: 'session-http-other',
      tabId: 'tab-http-other',
      clientId: 'client-http-other',
      managementSecret: 'manage-http-other-secret',
    };
    const otherBinding = await store.registerConnection(otherBrowser);
    const otherToken = await store.createTokenForWorkspace(otherBinding, { name: 'OAuth HTTP other', expiresInMs: 60_000 });
    const wrongBinding = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 31, method: 'ping', params: {},
    }, { Origin: 'https://client.example', Authorization: `Bearer ${otherToken.token}`, 'MCP-Session-Id': sessionId }));
    assert.equal(wrongBinding.status, 401);

    await store.registerConnection({
      ...browser,
      browserSessionId: 'session-http-replaced',
      tabId: 'tab-http-replaced',
      clientId: 'client-http-replaced',
    }, { replace: true });
    const movedBrowser = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 6, method: 'initialize', params: {},
    }, { Origin: 'https://client.example', Authorization: authorization }));
    assert.equal(movedBrowser.status, 200);

    const blockedOrigin = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 4, method: 'initialize', params: {},
    }, { Origin: 'https://evil.example', Authorization: authorization }));
    assert.equal(blockedOrigin.status, 403);

    const apiKeyAlias = await handleDiagramMcpHttpRequest(request('https://anchor.example/mcp', {
      jsonrpc: '2.0', id: 5, method: 'ping', params: {},
    }, { Origin: 'https://client.example', 'X-API-Key': created.token, 'MCP-Session-Id': sessionId }));
    assert.equal(apiKeyAlias.status, 401);
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
