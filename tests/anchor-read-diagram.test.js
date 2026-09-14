import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createWorkspaceFilePayload } from '../lib/workspace-file.js';
import { DIAGRAM_MCP_APP_RESOURCE_URI, DIAGRAM_MCP_APP_MIME_TYPE } from '../lib/diagram-mcp-app-resource.js';

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const serverPath = join(rootDirectory, 'mcp', 'anchor-read-diagram.mjs');

function childEnvironment(environment = {}) {
  return {
    ...process.env,
    ANCHORREAD_DIAGRAM_PERSONAL_TOKEN: '',
    ANCHORREAD_MCP_PERSONAL_TOKEN: '',
    ...environment,
  };
}

function callServer(workspacePath, requests, write = false) {
  return new Promise((resolve, reject) => {
    const args = [serverPath, workspacePath];
    if (write) args.push('--write');
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errorOutput += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(errorOutput || `MCP exited with ${code}`));
      try {
        resolve(output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).sort((a, b) => a.id - b.id));
      } catch (error) {
        reject(new Error(`${error.message}\n${output}`));
      }
    });
    child.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
  });
}

function callLiveServer(bridgeUrl, requests, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath, '--bridge', bridgeUrl], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnvironment(environment),
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errorOutput += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(errorOutput || `MCP exited with ${code}`));
      resolve(output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).sort((a, b) => a.id - b.id));
    });
    child.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
  });
}

function callRemoteServer(serverUrl, token, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath, '--server', serverUrl, '--token', token], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnvironment(),
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errorOutput += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(errorOutput || `MCP exited with ${code}`));
      try {
        resolve(output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).sort((a, b) => a.id - b.id));
      } catch (error) {
        reject(new Error(`${error.message}\n${output}`));
      }
    });
    child.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
  });
}

function callConfiguredRemoteServer(requests, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnvironment(environment),
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errorOutput += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(errorOutput || `MCP exited with ${code}`));
      try {
        resolve(output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).sort((a, b) => a.id - b.id));
      } catch (error) {
        reject(new Error(`${error.message}\n${output}`));
      }
    });
    child.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
  });
}

test('diagram MCP lists, describes and commits with revision protection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchor-read-diagram-'));
  const workspacePath = join(directory, 'workspace.anchorread');
  const payload = createWorkspaceFilePayload({
    drawings: [{
      id: 'drawing-1',
      documentId: 'doc-1',
      title: 'Architecture',
      engine: 'excalidraw',
      source: JSON.stringify([{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 40, height: 20, text: 'Start' }]),
      createdAt: 1,
      updatedAt: 1,
    }],
  });
  await writeFile(workspacePath, JSON.stringify(payload), 'utf8');
  try {
    const responses = await callServer(workspacePath, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_diagrams', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'describe_diagram', arguments: { id: 'drawing-1' } } },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_presentation', arguments: { id: 'drawing-1' } } },
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'open_diagram_workspace', arguments: {} } },
      { jsonrpc: '2.0', id: 91, method: 'tools/call', params: { name: 'ensure_workspace_ready', arguments: { open: false } } },
      { jsonrpc: '2.0', id: 10, method: 'resources/list', params: {} },
      { jsonrpc: '2.0', id: 11, method: 'resources/read', params: { uri: DIAGRAM_MCP_APP_RESOURCE_URI } },
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: {
        name: 'create_view',
        arguments: { elements: JSON.stringify([{ id: 'stdio-inline-rect', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }]) },
      } },
      { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'get_diagram', arguments: { id: 'drawing-1' } } },
      { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'get_diagram', arguments: { id: 'drawing-1', include: ['scene'] } } },
    ], false);
    assert.equal(responses[0].result.serverInfo.name, 'anchor-read-diagram');
    assert.equal(responses[0].result.serverInfo.title, 'AnchorRead Diagram');
    assert.deepEqual(responses[0].result.capabilities.resources, {});
    assert.match(responses[0].result.instructions, /source -> target -> connector/);
    assert.ok(responses[1].result.tools.some((tool) => tool.name === 'read_me'));
    assert.ok(responses[1].result.tools.some((tool) => tool.name === 'query_diagram'));
    assert.ok(responses[1].result.tools.some((tool) => tool.name === 'preflight_scene'));
    assert.ok(responses[1].result.tools.some((tool) => tool.name === 'verify_diagram'));
    const getDiagramSchema = responses[1].result.tools.find((tool) => tool.name === 'get_diagram').inputSchema;
    assert.deepEqual(getDiagramSchema.properties.projection.enum, ['summary', 'full']);
    assert.ok(getDiagramSchema.properties.include.items.enum.includes('scene'));
    assert.match(
      responses[1].result.tools.find((tool) => tool.name === 'create_view').description,
      /起点节点.*终点节点.*连线及关系文字/,
    );
    assert.match(responses[2].result.content[0].text, /Architecture/);
    assert.match(responses[3].result.content[0].text, /Total elements: 1/);
    assert.match(responses[4].result.content[0].text, /"presentation":\s*\{/);
    assert.match(responses[4].result.content[0].text, /"visibleElementIds":\s*\[\s*"a"\s*\]/);
    assert.equal(responses[5].result.content[1].type, 'resource_link');
    assert.match(responses[5].result.content[1].uri, /\/diagrams$/);
    assert.equal(responses.find((response) => response.id === 91).result.structuredContent.mode, 'local_stdio');
    assert.equal(responses.find((response) => response.id === 91).result.structuredContent.code, 'OPEN_NOT_REQUESTED');
    assert.equal(responses.find((response) => response.id === 10).result.resources[0].mimeType, DIAGRAM_MCP_APP_MIME_TYPE);
    assert.match(responses.find((response) => response.id === 11).result.contents[0].text, /Excalidraw/);
    const inline = responses.find((response) => response.id === 12).result;
    assert.match(inline.content[0].text, /stdio-inline-rect/);
    assert.equal(inline.structuredContent.engine, 'excalidraw');
    assert.equal(inline.structuredContent.scene.elements[0].id, 'stdio-inline-rect');
    const summary = responses.find((response) => response.id === 13).result.structuredContent;
    assert.equal(summary.elementCount, 1);
    assert.equal(summary.scene, undefined);
    assert.equal(responses.find((response) => response.id === 14).result.structuredContent.scene.elements[0].id, 'a');

    const writes = await callServer(workspacePath, [
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
        name: 'apply_diagram_patch',
        arguments: {
          id: 'drawing-1',
          patch: { update: [{ id: 'a', text: 'Updated' }] },
          expectedRevision: 0,
          author: 'test-agent',
          reason: 'rename',
        },
      } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: {
        name: 'apply_diagram_patch',
        arguments: { id: 'drawing-1', patch: { update: [{ id: 'a', text: 'Stale' }] }, expectedRevision: 0 },
      } },
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: {
        name: 'set_presentation',
        arguments: { id: 'drawing-1', presentation: { steps: [{ id: 'start', visibleElementIds: ['a'] }] } },
      } },
    ], true);
    assert.match(writes[0].result.content[0].text, /"revision": 1/);
    assert.equal(writes[0].result.structuredContent.scene, undefined);
    assert.equal(writes[1].result.isError, true);

    const updated = JSON.parse(await readFile(workspacePath, 'utf8'));
    assert.equal(updated.data.drawings[0].revision, 1);
    assert.equal(updated.data.drawings[0].scene.elements[0].text, 'Updated');
    assert.equal(updated.data.drawings[0].presentation.steps[0].visibleElementIds[0], 'a');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('offline stdio supports diagram-scoped element CRUD without global canvas state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchor-read-element-crud-'));
  const workspacePath = join(directory, 'workspace.anchorread');
  const payload = createWorkspaceFilePayload({
    drawings: [{
      id: 'drawing-crud',
      routeId: 'dg-crud1234',
      documentId: 'doc-1',
      title: 'CRUD',
      engine: 'excalidraw',
      scene: { elements: [{ id: 'start', type: 'rectangle', x: 0, y: 0, width: 40, height: 20 }] },
      source: JSON.stringify([{ id: 'start', type: 'rectangle', x: 0, y: 0, width: 40, height: 20 }]),
      revision: 1,
      revisionHistory: [],
      createdAt: 1,
      updatedAt: 1,
    }],
  });
  await writeFile(workspacePath, JSON.stringify(payload), 'utf8');
  try {
    const listed = await callServer(workspacePath, [{ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} }], true);
    assert.ok(listed[0].result.tools.some((tool) => tool.name === 'create_element'));
    assert.ok(listed[0].result.tools.some((tool) => tool.name === 'get_element'));
    const created = await callServer(workspacePath, [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_element', arguments: { id: 'drawing-crud', expectedRevision: 1, element: { id: 'note', type: 'text', x: 60, y: 0, text: 'Draft' } } } }], true);
    assert.match(created[0].result.content[0].text, /"revision": 2/);
    const queried = await callServer(workspacePath, [{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'query_elements', arguments: { id: 'drawing-crud', filters: { text: 'draft' } } } }], true);
    assert.match(queried[0].result.content[0].text, /"id": "note"/);
    const updated = await callServer(workspacePath, [{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'update_element', arguments: { id: 'drawing-crud', elementId: 'note', changes: { text: 'Published' }, expectedRevision: 2 } } }], true);
    assert.match(updated[0].result.content[0].text, /"revision": 3/);
    const read = await callServer(workspacePath, [{ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_element', arguments: { id: 'drawing-crud', elementId: 'note' } } }], true);
    assert.match(read[0].result.content[0].text, /Published/);
    const deleted = await callServer(workspacePath, [{ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'delete_element', arguments: { id: 'drawing-crud', elementId: 'note', expectedRevision: 3 } } }], true);
    assert.match(deleted[0].result.content[0].text, /"deleted": true/);
    const stored = JSON.parse(await readFile(workspacePath, 'utf8'));
    assert.equal(stored.data.drawings[0].scene.elements.find((element) => element.id === 'note').isDeleted, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('offline stdio batch_create_elements is idempotent and advertises conflict retries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchor-read-batch-create-'));
  const workspacePath = join(directory, 'workspace.anchorread');
  await writeFile(workspacePath, JSON.stringify(createWorkspaceFilePayload({
    drawings: [{
      id: 'drawing-batch',
      routeId: 'dg-batch123',
      title: 'Batch',
      engine: 'excalidraw',
      scene: { elements: [{ id: 'base', type: 'rectangle', x: 0, y: 0, width: 20, height: 20 }] },
      source: '[]',
      revision: 1,
      revisionHistory: [],
      createdAt: 1,
      updatedAt: 1,
    }],
  })), 'utf8');
  const batchArguments = {
    id: 'drawing-batch',
    expectedRevision: 1,
    retryOnConflict: true,
    maxConflictRetries: 2,
    operationId: 'stdio-batch-1',
    elements: [
      { id: 'new-a', type: 'rectangle', x: 40, y: 0, width: 20, height: 20 },
      { id: 'new-b', type: 'text', x: 80, y: 0, width: 40, height: 20, text: 'B' },
    ],
  };
  try {
    const responses = await callServer(workspacePath, [
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'batch_create_elements', arguments: batchArguments } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'batch_create_elements', arguments: batchArguments } },
    ], true);
    const schema = responses[0].result.tools.find((tool) => tool.name === 'batch_create_elements').inputSchema.properties;
    assert.equal(schema.retryOnConflict.type, 'boolean');
    assert.equal(schema.maxConflictRetries.maximum, 5);
    assert.equal(schema.includeScene.type, 'boolean');
    assert.equal(responses[1].result.structuredContent.revision, 2);
    assert.equal(responses[1].result.structuredContent.scene, undefined);
    assert.equal(responses[2].result.structuredContent.idempotentReplay, true);
    const stored = JSON.parse(await readFile(workspacePath, 'utf8'));
    assert.equal(stored.data.drawings[0].revision, 2);
    assert.deepEqual(stored.data.drawings[0].scene.elements.map((element) => element.id), ['base', 'new-a', 'new-b']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('offline stdio persists the migrated create_from_mermaid workflow', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchor-read-mermaid-create-'));
  const workspacePath = join(directory, 'workspace.anchorread');
  await writeFile(workspacePath, JSON.stringify(createWorkspaceFilePayload({ drawings: [] })), 'utf8');
  try {
    const responses = await callServer(workspacePath, [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'read_diagram_guide', arguments: {},
      } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'create_from_mermaid', arguments: {
          title: 'Offline Mermaid',
          mermaidDiagram: 'flowchart TD\n  A[Source] -->|calls| B[Target]',
          open: false,
        },
      } },
    ], true);
    assert.match(responses[0].result.content[0].text, /Required workflow/);
    assert.equal(responses[1].result.structuredContent.engine, undefined);
    assert.equal(responses[1].result.structuredContent.openRequested, false);
    assert.match(responses[1].result.structuredContent.url, /\/diagrams\//);
    const stored = JSON.parse(await readFile(workspacePath, 'utf8'));
    assert.equal(stored.data.drawings.length, 1);
    assert.equal(stored.data.drawings[0].source, 'flowchart TD\n  A[Source] -->|calls| B[Target]');
    assert.equal(stored.data.drawings[0].revision, undefined);
    assert.equal(stored.data.drawings[0].presentation.steps.length > 0, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('live mode exposes create_diagram and forwards it to the browser bridge', async () => {
  let received = null;
  let receivedToken = '';
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received = JSON.parse(body);
      receivedToken = request.headers['x-anchorread-bridge-token'] || '';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, requestId: 'request-live-1', result: {
        id: 'drawing-live-1', routeId: 'dg-live-1', revision: 1,
      } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const responses = await callLiveServer(`http://127.0.0.1:${port}`, [
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'create_diagram',
        arguments: { title: 'Live concept', engine: 'mermaid', source: 'flowchart TD\nA-->B' },
      } },
    ], { ANCHORREAD_DIAGRAM_BRIDGE_TOKEN: 'test-token' });
    const createTool = responses[0].result.tools.find((tool) => tool.name === 'create_diagram');
    assert.ok(createTool);
    assert.equal(createTool._meta.ui.resourceUri, DIAGRAM_MCP_APP_RESOURCE_URI);
    assert.match(responses[1].result.content[0].text, /drawing-live-1/);
    assert.equal(responses[1].result.structuredContent.routeId, 'dg-live-1');
    assert.equal(responses[1].result.structuredContent.revision, 1);
    assert.equal(responses[1].result.structuredContent.queued, undefined);
    assert.equal(received.action, 'submit');
    assert.equal(received.request.tool, 'create_diagram');
    assert.equal(received.request.args.title, 'Live concept');
    assert.equal(receivedToken, 'test-token');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('remote personal-token mode initializes MCP and forwards bearer auth', async () => {
  const requests = [];
  let serverSession = '';
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body);
      requests.push({ payload, authorization: request.headers.authorization || '' });
      response.setHeader('content-type', 'application/json');
      if (payload.method === 'initialize') {
        serverSession = 'remote-session-1';
        response.setHeader('mcp-session-id', serverSession);
        response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'anchorread-remote-test', version: '1.0.0' },
        } }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: {
        content: [{ type: 'text', text: 'remote-ok' }],
        structuredContent: { id: 'remote-drawing', revision: 4 },
      } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const responses = await callRemoteServer(`http://127.0.0.1:${port}`, 'personal-test-token', [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'get_diagram', arguments: { id: 'remote-drawing' },
      } },
    ]);
    assert.equal(responses[0].result.structuredContent.revision, 4);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].payload.method, 'initialize');
    assert.equal(requests[1].payload.method, 'tools/call');
    assert.equal(requests[1].payload.params.name, 'get_diagram');
    assert.equal(requests[1].authorization, 'Bearer personal-test-token');
    assert.equal(requests[1].payload.jsonrpc, '2.0');
    assert.equal(requests[0].authorization, 'Bearer personal-test-token');
    assert.equal(requests[1].payload.params.arguments.id, 'remote-drawing');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('remote mode fails clearly when Personal Token is missing', async () => {
  const responses = await callRemoteServer('https://anchorread.example', '', [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'list_diagrams', arguments: {},
    } },
  ]);
  assert.equal(responses[0].result.isError, true);
  assert.equal(responses[0].result.structuredContent.code, 'PERSONAL_TOKEN_REQUIRED');
  assert.match(responses[0].result.content[0].text, /Personal Token/);
});

test('remote mode accepts server and Personal Token from environment', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body);
      requests.push({ payload, authorization: request.headers.authorization || '' });
      response.setHeader('content-type', 'application/json');
      if (payload.method === 'initialize') response.setHeader('mcp-session-id', 'remote-env-session');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: {
        content: [{ type: 'text', text: 'env-ok' }],
        structuredContent: { id: 'env-drawing' },
      } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const responses = await callConfiguredRemoteServer([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'list_diagrams', arguments: {},
      } },
    ], {
      ANCHORREAD_DIAGRAM_SERVER_URL: `http://127.0.0.1:${port}`,
      ANCHORREAD_DIAGRAM_PERSONAL_TOKEN: 'env-personal-token',
    });
    assert.equal(responses[0].result.structuredContent.id, 'env-drawing');
    assert.equal(requests[0].authorization, 'Bearer env-personal-token');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('live mode returns a workspace recovery link when no browser claims a request', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(504, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, code: 'BRIDGE_TIMEOUT', error: 'No open AnchorRead browser claimed the request.' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const responses = await callLiveServer(`http://127.0.0.1:${port}`, [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'create_diagram', arguments: { title: 'Needs browser', engine: 'excalidraw' },
      } },
    ]);
    assert.equal(responses[0].result.isError, true);
    assert.match(responses[0].result.content[0].text, /open_diagram_workspace_then_retry/);
    assert.equal(responses[0].result.content[1].type, 'resource_link');
    assert.match(responses[0].result.content[1].uri, /\/diagrams$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('live mode never reports an unpersisted contentful diagram as success', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(504, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, code: 'BRIDGE_TIMEOUT', error: 'No open AnchorRead browser claimed the request.' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const responses = await callLiveServer(`http://127.0.0.1:${port}`, [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'create_diagram', arguments: { title: 'Chat flow', engine: 'mermaid', source: 'flowchart TD\nA-->B' },
      } },
    ]);
    assert.equal(responses[0].result.isError, true);
    assert.equal(responses[0].result.structuredContent.code, 'BRIDGE_TIMEOUT');
    assert.equal(responses[0].result.structuredContent.nextAction, 'open_diagram_workspace_then_retry');
    assert.doesNotMatch(responses[0].result.content[0].text, /flowchart TD/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
