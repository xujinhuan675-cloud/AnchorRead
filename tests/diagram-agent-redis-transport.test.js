import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRedisDiagramAgentTransport } from '../lib/diagram-agent-redis-transport.js';
import { FakeRedisClient } from './helpers/fake-redis-client.js';
import { getDiagramAgentBuildInfo } from '../lib/diagram-agent-protocol.js';

function client(overrides = {}) {
  return {
    workspaceId: 'workspace-shared',
    bindingId: 'binding-shared',
    browserSessionId: 'session-shared',
    tabId: 'tab-shared',
    visible: true,
    focused: true,
    ...getDiagramAgentBuildInfo(),
    ...overrides,
  };
}

function transports() {
  const redis = new FakeRedisClient();
  const prefix = `test:${randomUUID()}`;
  const logs = [];
  return {
    logs,
    submitter: createRedisDiagramAgentTransport({ client: redis, prefix, instanceId: 'instance-submit', logger: (event) => logs.push(event) }),
    browser: createRedisDiagramAgentTransport({ client: redis, prefix, instanceId: 'instance-browser', logger: (event) => logs.push(event) }),
  };
}

test('Redis broker completes enqueue, claim, and resolve across Node instances', async () => {
  const { submitter, browser, logs } = transports();
  const scope = client();
  const created = await submitter.createRequest(
    { tool: 'list_diagrams', args: {} },
    { ttlMs: 5_000, scope, tokenId: 'token-shared' },
  );

  const claimed = await browser.claimRequests('client-shared', { client: scope });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, created.id);
  assert.equal(await browser.resolveRequest(
    created.id,
    claimed[0].claimToken,
    [{ id: 'diagram-shared' }],
    undefined,
    { client: { ...scope, clientId: 'client-shared' } },
  ), true);
  assert.deepEqual(await created.promise, [{ id: 'diagram-shared' }]);

  assert.equal(logs.find((event) => event.event === 'request_enqueued')?.instance_id, 'instance-submit');
  assert.equal(logs.find((event) => event.event === 'request_claimed')?.instance_id, 'instance-browser');
  assert.equal(logs.find((event) => event.event === 'request_completed')?.resolve_instance_id, 'instance-browser');
});

test('Redis broker lets the stable browser client claim work while its tab is hidden', async () => {
  const { submitter, browser } = transports();
  const scope = client({ visible: false, focused: false });
  const created = await submitter.createRequest(
    { tool: 'get_diagram', args: { id: 'diagram-background' } },
    { ttlMs: 5_000, scope },
  );

  const [claimed] = await browser.claimRequests('client-background', { client: scope });
  assert.equal(claimed?.id, created.id);
  await browser.resolveRequest(
    created.id,
    claimed.claimToken,
    { id: 'diagram-background' },
    undefined,
    { client: { ...scope, clientId: 'client-background' } },
  );
  assert.deepEqual(await created.promise, { id: 'diagram-background' });
});

test('Redis broker rejects a resolve from a client that did not claim the request', async () => {
  const { submitter, browser } = transports();
  const scope = client();
  const created = await submitter.createRequest(
    { tool: 'get_diagram', args: { id: 'diagram-a' } },
    { ttlMs: 5_000, scope },
  );
  const [claimed] = await browser.claimRequests('client-shared', { client: scope });

  assert.equal(await browser.resolveRequest(
    created.id,
    claimed.claimToken,
    { id: 'forged' },
    undefined,
    { client: { ...scope, clientId: 'different-client' } },
  ), false);
  assert.equal(await browser.resolveRequest(
    created.id,
    claimed.claimToken,
    { id: 'diagram-a' },
    undefined,
    { client: { ...scope, clientId: 'client-shared' } },
  ), true);
  assert.deepEqual(await created.promise, { id: 'diagram-a' });
});

test('Redis broker keeps workspace shards isolated', async () => {
  const { submitter, browser } = transports();
  const created = await submitter.createRequest(
    { tool: 'list_diagrams', args: {} },
    { ttlMs: 5_000, scope: client() },
  );

  assert.deepEqual(await browser.claimRequests('client-wrong', {
    client: client({ workspaceId: 'workspace-other', bindingId: 'binding-other' }),
  }), []);
  const [claimed] = await browser.claimRequests('client-shared', { client: client() });
  assert.equal(claimed.id, created.id);
  await browser.resolveRequest(
    created.id,
    claimed.claimToken,
    [],
    undefined,
    { client: { ...client(), clientId: 'client-shared' } },
  );
  await created.promise;
});

test('Redis broker keeps browser bindings isolated within one workspace', async () => {
  const { submitter, browser } = transports();
  const created = await submitter.createRequest(
    { tool: 'list_diagrams', args: {} },
    { ttlMs: 5_000, scope: client({ bindingId: 'binding-one' }) },
  );

  assert.deepEqual(await browser.claimRequests('client-two', {
    client: client({ bindingId: 'binding-two' }),
  }), []);
  const [claimed] = await browser.claimRequests('client-one', {
    client: client({ bindingId: 'binding-one' }),
  });
  assert.equal(claimed.id, created.id);
  await browser.resolveRequest(
    created.id,
    claimed.claimToken,
    [],
    undefined,
    { client: { ...client({ bindingId: 'binding-one' }), clientId: 'client-one' } },
  );
  await created.promise;
});

test('Redis broker propagates token revocation to the submitting instance', async () => {
  const { submitter, browser } = transports();
  const created = await submitter.createRequest(
    { tool: 'list_diagrams', args: {} },
    { ttlMs: 5_000, scope: client(), tokenId: 'token-revoked' },
  );
  const error = new Error('Remote MCP token was revoked.');
  error.code = 'TOKEN_REVOKED';

  assert.equal(await browser.cancelRequestsForToken('token-revoked', error), 1);
  await assert.rejects(created.promise, { code: 'TOKEN_REVOKED' });
});
