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
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { createRedisDiagramAgentTransport } from './diagram-agent-redis-transport.js';
import { diagramAgentBuildCompatibility } from './diagram-agent-protocol.js';

const TRANSPORT_OVERRIDE_KEY = Symbol.for('anchor-read.diagram-agent-transport-override');
const TRANSPORT_KEY = Symbol.for('anchor-read.diagram-agent-transport');
const INSTANCE_KEY = Symbol.for('anchor-read.diagram-agent-instance-id');

export function getDiagramAgentInstanceId() {
  if (!globalThis[INSTANCE_KEY]) {
    const configured = String(process.env.ANCHORREAD_INSTANCE_ID || '').trim();
    globalThis[INSTANCE_KEY] = configured
      || `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  }
  return globalThis[INSTANCE_KEY];
}

function clientMatches(client, target = {}) {
  return ['workspaceId', 'bindingId', 'browserSessionId', 'tabId', 'clientId'].every((field) => (
    !String(target[field] || '').trim() || String(target[field]).trim() === client[field]
  ));
}

const memoryTransport = Object.freeze({
  runtimeInfo: Object.freeze({
    requestBroker: 'memory',
    transport: 'long-poll',
    multiInstance: false,
    sharedRequestBroker: false,
    requestRoutingMultiInstance: false,
    mcpSessionAffinityRequired: true,
    instanceId: getDiagramAgentInstanceId(),
  }),
  createRequest: (payload, options) => createDiagramAgentRequest(payload, options),
  cancelRequest: (requestId, error) => cancelDiagramAgentRequest(requestId, error),
  cancelRequestsForToken: (tokenId, error) => cancelDiagramAgentRequestsForToken(tokenId, error),
  claimRequests: (clientId, options) => claimDiagramAgentRequests(clientId, options),
  waitForRequests: (clientId, options) => waitForDiagramAgentRequests(clientId, options),
  resolveRequest: (requestId, claimToken, result, error) => resolveDiagramAgentRequest(requestId, claimToken, result, error),
  registerClient: (clientId, client) => registerDiagramAgentClient(clientId, client),
  unregisterClient: (clientId) => unregisterDiagramAgentClient(clientId),
  getPresence: (client = {}) => {
    const matching = getDiagramAgentBrokerSnapshot().clients
      .filter((candidate) => clientMatches(candidate, client))
      .sort((left, right) => Number(right.focused) - Number(left.focused) || right.seenAt - left.seenAt);
    if (!matching[0]) return null;
    const compatibility = diagramAgentBuildCompatibility(matching[0]);
    return {
      online: true,
      connected: compatibility.compatible,
      writable: compatibility.compatible,
      status: compatibility.compatible ? 'connected' : 'stale',
      expected: compatibility.expected,
      actual: compatibility.actual,
      versionCompatible: compatibility.compatible,
      ...matching[0],
    };
  },
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
  if (globalThis[TRANSPORT_OVERRIDE_KEY]) return globalThis[TRANSPORT_OVERRIDE_KEY];
  const broker = String(process.env.ANCHORREAD_DIAGRAM_BROKER || 'memory').trim().toLowerCase();
  if (broker === 'memory') return memoryTransport;
  if (broker !== 'redis') {
    const error = new Error(`Unsupported ANCHORREAD_DIAGRAM_BROKER: ${broker}`);
    error.code = 'BROKER_CONFIG_ERROR';
    throw error;
  }
  if (!globalThis[TRANSPORT_KEY]) {
    globalThis[TRANSPORT_KEY] = createRedisDiagramAgentTransport({
      instanceId: getDiagramAgentInstanceId(),
    });
  }
  return globalThis[TRANSPORT_KEY];
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
  delete globalThis[TRANSPORT_KEY];
  delete globalThis[INSTANCE_KEY];
}
