import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createWorkspaceFilePayload } from '../lib/workspace-file.js';

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const serverPath = join(rootDirectory, 'mcp', 'anchor-read-diagram-mcp.mjs');

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
  const directory = await mkdtemp(join(tmpdir(), 'anchor-read-diagram-mcp-'));
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
    ], false);
    assert.equal(responses[0].result.serverInfo.name, 'anchor-read-diagram-mcp');
    assert.ok(responses[1].result.tools.some((tool) => tool.name === 'query_diagram'));
    assert.match(responses[2].result.content[0].text, /Architecture/);
    assert.match(responses[3].result.content[0].text, /Total elements: 1/);
    assert.match(responses[4].result.content[0].text, /"presentation": null/);

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
      response.end(JSON.stringify({ ok: true, result: { id: 'live-1', routeId: 'dg-12345678' } }));
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
    assert.ok(responses[0].result.tools.some((tool) => tool.name === 'create_diagram'));
    assert.match(responses[1].result.content[0].text, /live-1/);
    assert.equal(received.action, 'submit');
    assert.equal(received.request.tool, 'create_diagram');
    assert.equal(received.request.args.title, 'Live concept');
    assert.equal(receivedToken, 'test-token');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
