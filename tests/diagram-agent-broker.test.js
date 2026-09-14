import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimDiagramAgentRequests,
  cancelDiagramAgentRequest,
  createDiagramAgentRequest,
  getDiagramAgentBrokerSnapshot,
  resolveDiagramAgentRequest,
  resetDiagramAgentBrokerForTests,
  waitForDiagramAgentRequests,
} from '../lib/diagram-agent-broker.js';
import { getDiagramAgentBuildInfo } from '../lib/diagram-agent-protocol.js';

const compatibleClient = (overrides = {}) => ({ ...getDiagramAgentBuildInfo(), ...overrides });

test.afterEach(() => resetDiagramAgentBrokerForTests());

test('browser bridge claims and resolves a queued request', async () => {
  const { id, promise } = createDiagramAgentRequest({ tool: 'list_diagrams', args: {} }, { ttlMs: 5_000 });
  const claimed = claimDiagramAgentRequests(`test-client-${id}`, { client: compatibleClient() });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, id);
  assert.equal(resolveDiagramAgentRequest(id, claimed[0].claimToken, { ok: true }), true);
  assert.deepEqual(await promise, { ok: true });
});

test('long polling returns when a request arrives', async () => {
  const clientId = `wait-client-${Date.now()}-${Math.random()}`;
  const pending = waitForDiagramAgentRequests(clientId, { waitMs: 1_000, client: compatibleClient() });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const { id, promise } = createDiagramAgentRequest({ tool: 'get_diagram', args: { id: 'x' } });
  const claimed = await pending;
  assert.equal(claimed[0].id, id);
  resolveDiagramAgentRequest(id, claimed[0].claimToken, { ok: true });
  await promise;
});

test('a background browser client stays eligible for unaddressed work', async () => {
  const suffix = `active-${Date.now()}-${Math.random()}`;
  const first = `client-first-${suffix}`;
  const second = `client-second-${suffix}`;
  const { id, promise } = createDiagramAgentRequest({ tool: 'list_diagrams', args: {} });
  const backgroundClaimed = claimDiagramAgentRequests(first, {
    client: compatibleClient({ tabId: 'tab-first', visible: false, focused: false }),
  });
  assert.equal(backgroundClaimed[0]?.id, id);
  resolveDiagramAgentRequest(id, backgroundClaimed[0].claimToken, { ok: true });
  await promise;
});

test('a visible client wins unaddressed work when background and visible clients are both registered', async () => {
  const suffix = `priority-${Date.now()}-${Math.random()}`;
  const first = `client-first-${suffix}`;
  const second = `client-second-${suffix}`;
  claimDiagramAgentRequests(first, {
    client: compatibleClient({ tabId: 'tab-first', visible: false, focused: false }),
  });
  const { id, promise } = createDiagramAgentRequest({ tool: 'list_diagrams', args: {} });
  const claimed = claimDiagramAgentRequests(second, {
    client: compatibleClient({ tabId: 'tab-second', visible: true, focused: true }),
  });
  assert.equal(claimed[0]?.id, id);
  assert.equal(getDiagramAgentBrokerSnapshot().clients.some((client) => client.clientId === second), true);
  resolveDiagramAgentRequest(id, claimed[0].claimToken, { ok: true });
  await promise;
});

test('a scoped request follows its workspace across browser sessions', async () => {
  const { id, promise } = createDiagramAgentRequest(
    { tool: 'list_diagrams', args: {} },
    { scope: { workspaceId: 'workspace-a' } },
  );
  assert.deepEqual(claimDiagramAgentRequests('wrong-client', {
    client: compatibleClient({ workspaceId: 'workspace-b', browserSessionId: 'session-b', tabId: 'tab-b' }),
  }), []);
  const claimed = claimDiagramAgentRequests('right-client', {
    client: compatibleClient({ workspaceId: 'workspace-a', browserSessionId: 'reopened-session', tabId: 'reopened-tab' }),
  });
  assert.equal(claimed[0]?.id, id);
  resolveDiagramAgentRequest(id, claimed[0].claimToken, { ok: true });
  await promise;
});

test('an online client without a compatible build cannot claim writes', async () => {
  const { id, promise } = createDiagramAgentRequest({
    tool: 'batch_create_elements',
    args: { id: 'diagram-stale', elements: [{ id: 'new', type: 'rectangle' }] },
  });
  const claimed = claimDiagramAgentRequests('stale-client', {
    client: compatibleClient({ protocolVersion: '1' }),
  });
  assert.deepEqual(claimed, []);
  const presence = getDiagramAgentBrokerSnapshot().clients.find((client) => client.clientId === 'stale-client');
  assert.equal(presence.protocolVersion, '1');
  cancelDiagramAgentRequest(id, new Error('test cleanup'));
  await assert.rejects(promise, /test cleanup/);
});
