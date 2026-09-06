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
      env: { ...process.env, ...environment },
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
      { jsonrpc: '2.0', id: 10, method: 'resources/list', params: {} },
      { jsonrpc: '2.0', id: 11, method: 'resources/read', params: { uri: DIAGRAM_MCP_APP_RESOURCE_URI } },
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: {
        name: 'create_view',
        arguments: { elements: JSON.stringify([{ id: 'stdio-inline-rect', type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }]) },
      } },
    ], false);
    assert.equal(responses[0].result.serverInfo.name, 'anchor-read-diagram');
    assert.equal(responses[0].result.serverInfo.title, 'AnchorRead Diagram');
    assert.deepEqual(responses[0].result.capabilities.resources, {});
    assert.match(responses[0].result.instructions, /shape -> arrow -> shape/);
    assert.ok(responses[1].result.tools.some((tool) => tool.name === 'read_me'));
    assert.ok(responses[1].result.tools.some((tool) => tool.name === 'query_diagram'));
    assert.match(
      responses[1].result.tools.find((tool) => tool.name === 'create_view').description,
      /带 label 的节点、箭头、下一个带 label 的节点/,
    );
    assert.match(responses[2].result.content[0].text, /Architecture/);
    assert.match(responses[3].result.content[0].text, /Total elements: 1/);
    assert.match(responses[4].result.content[0].text, /"presentation":\s*\{/);
    assert.match(responses[4].result.content[0].text, /"visibleElementIds":\s*\[\s*"a"\s*\]/);
    assert.equal(responses[5].result.content[1].type, 'resource_link');
    assert.match(responses[5].result.content[1].uri, /\/diagrams$/);
    assert.equal(responses.find((response) => response.id === 10).result.resources[0].mimeType, DIAGRAM_MCP_APP_MIME_TYPE);
    assert.match(responses.find((response) => response.id === 11).result.contents[0].text, /Excalidraw/);
    const inline = responses.find((response) => response.id === 12).result;
    assert.match(inline.content[0].text, /stdio-inline-rect/);
    assert.equal(inline.structuredContent.engine, 'excalidraw');
    assert.equal(inline.structuredContent.scene.elements[0].id, 'stdio-inline-rect');

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
      response.end(JSON.stringify({ ok: true, requestId: 'wake-live-1' }));
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
    assert.match(responses[1].result.content[0].text, /wake-live-1/);
    assert.equal(received.action, 'queue');
    assert.equal(received.request.tool, 'create_diagram');
    assert.equal(received.request.args.title, 'Live concept');
    assert.equal(receivedToken, 'test-token');
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

test('live mode keeps diagram content in the chat when the browser is offline', async () => {
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
    assert.equal(responses[0].result.isError, undefined);
    assert.match(responses[0].result.content[0].text, /flowchart TD/);
    assert.match(responses[0].result.content[0].text, /对话画布/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
