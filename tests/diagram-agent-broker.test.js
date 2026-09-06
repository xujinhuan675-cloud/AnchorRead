import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimDiagramAgentRequests,
  createDiagramAgentRequest,
  getDiagramAgentBrokerSnapshot,
  resolveDiagramAgentRequest,
  resetDiagramAgentBrokerForTests,
  waitForDiagramAgentRequests,
} from '../lib/diagram-agent-broker.js';

test.afterEach(() => resetDiagramAgentBrokerForTests());

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

test('only the active focused browser client claims an unaddressed request', async () => {
  const suffix = `active-${Date.now()}-${Math.random()}`;
  const first = `client-first-${suffix}`;
  const second = `client-second-${suffix}`;
  const { id, promise } = createDiagramAgentRequest({ tool: 'list_diagrams', args: {} });
  assert.deepEqual(claimDiagramAgentRequests(first, {
    client: { tabId: 'tab-first', visible: false, focused: false },
  }), []);
  const claimed = claimDiagramAgentRequests(second, {
    client: { tabId: 'tab-second', visible: true, focused: true },
  });
  assert.equal(claimed[0]?.id, id);
  assert.equal(getDiagramAgentBrokerSnapshot().clients.some((client) => client.clientId === second), true);
  resolveDiagramAgentRequest(id, claimed[0].claimToken, { ok: true });
  await promise;
});

test('a scoped request is only claimable by its exact workspace and browser session', async () => {
  const { id, promise } = createDiagramAgentRequest(
    { tool: 'list_diagrams', args: {} },
    { scope: { workspaceId: 'workspace-a', browserSessionId: 'session-a', tabId: 'tab-a' } },
  );
  assert.deepEqual(claimDiagramAgentRequests('wrong-client', {
    client: { workspaceId: 'workspace-b', browserSessionId: 'session-b', tabId: 'tab-b' },
  }), []);
  const claimed = claimDiagramAgentRequests('right-client', {
    client: { workspaceId: 'workspace-a', browserSessionId: 'session-a', tabId: 'tab-a' },
  });
  assert.equal(claimed[0]?.id, id);
  resolveDiagramAgentRequest(id, claimed[0].claimToken, { ok: true });
  await promise;
});

test('a deferred browser wake request requires its one-time request id', async () => {
  const { id, promise } = createDiagramAgentRequest(
    { tool: 'create_diagram', args: { title: 'Wake me' } },
    { wakeOnly: true },
  );
  claimDiagramAgentRequests('already-open-client', { client: { visible: true, focused: true } });
  assert.deepEqual(claimDiagramAgentRequests('ordinary-client'), []);
  assert.deepEqual(claimDiagramAgentRequests('wrong-wake-client', { wakeRequestId: 'wrong' }), []);
  const claimed = claimDiagramAgentRequests('default-browser-client', { wakeRequestId: id });
  assert.equal(claimed[0]?.id, id);
  resolveDiagramAgentRequest(id, claimed[0].claimToken, { ok: true });
  await promise;
});
