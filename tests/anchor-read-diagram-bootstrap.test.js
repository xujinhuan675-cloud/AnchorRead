import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const bootstrapPath = join(rootDirectory, 'mcp', 'anchor-read-diagram-bootstrap.mjs');

function callBootstrap(requests, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bootstrapPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...environment },
    });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errorOutput += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(errorOutput || `bootstrap exited with ${code}`));
      try {
        resolve(output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
      } catch (error) {
        reject(new Error(`${error.message}\n${output}`));
      }
    });
    child.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
  });
}

test('local browser bootstrap exposes only a safe workspace wake operation', async () => {
  const responses = await callBootstrap([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ensure_anchorread_workspace', arguments: {} } },
  ], { ANCHORREAD_DIAGRAM_AUTO_OPEN: 'false' });

  assert.equal(responses[0].result.serverInfo.name, 'anchorread-browser-bootstrap');
  assert.deepEqual(responses[1].result.tools.map((tool) => tool.name), ['ensure_anchorread_workspace']);
  const result = responses[2].result.structuredContent;
  assert.equal(result.mode, 'local_browser_bootstrap');
  assert.equal(result.ready, false);
  assert.equal(result.code, 'AUTO_OPEN_DISABLED');
  assert.match(result.url, /^https:\/\/anchorread\.flowguide\.cc\/diagrams$/);
  assert.equal(responses[2].result.content[1].type, 'resource_link');
});
