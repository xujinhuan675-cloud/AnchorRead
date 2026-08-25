import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimDiagramAgentRequests,
  createDiagramAgentRequest,
  resolveDiagramAgentRequest,
  waitForDiagramAgentRequests,
} from '../lib/diagram-agent-broker.js';

test('browser bridge claims and resolves a queued request', async () => {
  const { id, promise } = createDiagramAgentRequest({ tool: 'list_diagrams', args: {} }, { ttlMs: 5_000 });
  const claimed = claimDiagramAgentRequests(`test-client-${id}`);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, id);
  assert.equal(resolveDiagramAgentRequest(id, claimed[0].claimToken, { ok: true }), true);
  assert.deepEqual(await promise, { ok: true });
});

test('long polling returns when a request arrives', async () => {
  const clientId = `wait-client-${Date.now()}-${Math.random()}`;
  const pending = waitForDiagramAgentRequests(clientId, { waitMs: 1_000 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const { id, promise } = createDiagramAgentRequest({ tool: 'get_diagram', args: { id: 'x' } });
  const claimed = await pending;
  assert.equal(claimed[0].id, id);
  resolveDiagramAgentRequest(id, claimed[0].claimToken, { ok: true });
  await promise;
});
