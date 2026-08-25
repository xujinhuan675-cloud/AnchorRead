import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDiagramAgentTransport,
  resetDiagramAgentTransportForTests,
  setDiagramAgentTransport,
} from '../lib/diagram-agent-transport.js';

test.afterEach(() => resetDiagramAgentTransportForTests());

test('diagram transport defaults to memory and accepts a complete future adapter', () => {
  assert.deepEqual(getDiagramAgentTransport().runtimeInfo, {
    requestBroker: 'memory',
    transport: 'long-poll',
    multiInstance: false,
  });
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

test('diagram transport rejects incomplete adapters', () => {
  assert.throws(() => setDiagramAgentTransport({ createRequest() {} }), /missing cancelRequest/u);
});
