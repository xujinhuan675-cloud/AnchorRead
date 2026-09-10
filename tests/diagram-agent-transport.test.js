import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDiagramAgentTransport,
  resetDiagramAgentTransportForTests,
  setDiagramAgentTransport,
} from '../lib/diagram-agent-transport.js';

test.afterEach(() => resetDiagramAgentTransportForTests());

test('diagram transport defaults to memory and accepts a complete future adapter', () => {
  assert.equal(getDiagramAgentTransport().runtimeInfo.requestBroker, 'memory');
  assert.equal(getDiagramAgentTransport().runtimeInfo.sharedRequestBroker, false);
  assert.equal(getDiagramAgentTransport().runtimeInfo.requestRoutingMultiInstance, false);
  assert.match(getDiagramAgentTransport().runtimeInfo.instanceId, /.+/u);
  const noop = () => {};
  const adapter = {
    runtimeInfo: { requestBroker: 'redis', transport: 'websocket', multiInstance: true },
    createRequest: noop,
    cancelRequest: noop,
    cancelRequestsForToken: noop,
    claimRequests: noop,
    waitForRequests: noop,
    resolveRequest: noop,
    registerClient: noop,
    unregisterClient: noop,
  };
  setDiagramAgentTransport(adapter);
  assert.equal(getDiagramAgentTransport(), adapter);
});

test('diagram transport selects Redis explicitly without connecting during module setup', () => {
  const previousBroker = process.env.ANCHORREAD_DIAGRAM_BROKER;
  try {
    process.env.ANCHORREAD_DIAGRAM_BROKER = 'redis';
    resetDiagramAgentTransportForTests();
    const transport = getDiagramAgentTransport();
    assert.equal(transport.runtimeInfo.requestBroker, 'redis');
    assert.equal(transport.runtimeInfo.sharedRequestBroker, true);
    assert.equal(transport.runtimeInfo.requestRoutingMultiInstance, true);
    assert.equal(transport.runtimeInfo.mcpSessionAffinityRequired, true);
  } finally {
    if (previousBroker === undefined) delete process.env.ANCHORREAD_DIAGRAM_BROKER;
    else process.env.ANCHORREAD_DIAGRAM_BROKER = previousBroker;
    resetDiagramAgentTransportForTests();
  }
});

test('Redis transport fails closed when its URL is missing', async () => {
  const previousBroker = process.env.ANCHORREAD_DIAGRAM_BROKER;
  const previousUrl = process.env.ANCHORREAD_REDIS_URL;
  try {
    process.env.ANCHORREAD_DIAGRAM_BROKER = 'redis';
    delete process.env.ANCHORREAD_REDIS_URL;
    resetDiagramAgentTransportForTests();
    await assert.rejects(
      getDiagramAgentTransport().createRequest({ tool: 'list_diagrams', args: {} }),
      { code: 'BROKER_CONFIG_ERROR' },
    );
  } finally {
    if (previousBroker === undefined) delete process.env.ANCHORREAD_DIAGRAM_BROKER;
    else process.env.ANCHORREAD_DIAGRAM_BROKER = previousBroker;
    if (previousUrl === undefined) delete process.env.ANCHORREAD_REDIS_URL;
    else process.env.ANCHORREAD_REDIS_URL = previousUrl;
    resetDiagramAgentTransportForTests();
  }
});

test('diagram transport rejects incomplete adapters', () => {
  assert.throws(() => setDiagramAgentTransport({ createRequest() {} }), /missing cancelRequest/u);
});
