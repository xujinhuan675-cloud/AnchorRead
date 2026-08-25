import {
  cancelDiagramAgentRequest,
  cancelDiagramAgentRequestsForToken,
  claimDiagramAgentRequests,
  createDiagramAgentRequest,
  getDiagramAgentBrokerSnapshot,
  registerDiagramAgentClient,
  resolveDiagramAgentRequest,
  unregisterDiagramAgentClient,
  waitForDiagramAgentRequests,
} from './diagram-agent-broker.js';

const TRANSPORT_OVERRIDE_KEY = Symbol.for('anchor-read.diagram-agent-transport-override');

const memoryTransport = Object.freeze({
  runtimeInfo: Object.freeze({
    requestBroker: 'memory',
    transport: 'long-poll',
    multiInstance: false,
  }),
  createRequest: (payload, options) => createDiagramAgentRequest(payload, options),
  cancelRequest: (requestId, error) => cancelDiagramAgentRequest(requestId, error),
  cancelRequestsForToken: (tokenId, error) => cancelDiagramAgentRequestsForToken(tokenId, error),
  claimRequests: (clientId, options) => claimDiagramAgentRequests(clientId, options),
  waitForRequests: (clientId, options) => waitForDiagramAgentRequests(clientId, options),
  resolveRequest: (requestId, claimToken, result, error) => resolveDiagramAgentRequest(requestId, claimToken, result, error),
  registerClient: (clientId, client) => registerDiagramAgentClient(clientId, client),
  unregisterClient: (clientId) => unregisterDiagramAgentClient(clientId),
  snapshot: () => getDiagramAgentBrokerSnapshot(),
});

const REQUIRED_METHODS = [
  'createRequest',
  'cancelRequest',
  'cancelRequestsForToken',
  'claimRequests',
  'waitForRequests',
  'resolveRequest',
  'registerClient',
  'unregisterClient',
];

export function getDiagramAgentTransport() {
  return globalThis[TRANSPORT_OVERRIDE_KEY] || memoryTransport;
}

export function setDiagramAgentTransport(transport) {
  if (transport == null) {
    delete globalThis[TRANSPORT_OVERRIDE_KEY];
    return;
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof transport[method] !== 'function') throw new TypeError(`Diagram agent transport is missing ${method}().`);
  }
  globalThis[TRANSPORT_OVERRIDE_KEY] = transport;
}

export function resetDiagramAgentTransportForTests() {
  delete globalThis[TRANSPORT_OVERRIDE_KEY];
}
