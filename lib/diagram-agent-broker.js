const BROKER_KEY = Symbol.for('anchor-read.diagram-agent-broker');
const MAX_PENDING = 32;
const DEFAULT_TTL_MS = 60_000;

function getState() {
  if (!globalThis[BROKER_KEY]) {
    globalThis[BROKER_KEY] = {
      requests: new Map(),
      pending: [],
    };
  }
  return globalThis[BROKER_KEY];
}

function id(prefix = 'diagram-agent') {
  const suffix = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function cleanup(state = getState(), now = Date.now()) {
  for (const [requestId, request] of state.requests) {
    if (request.expiresAt <= now && request.status !== 'resolved') {
      request.status = 'expired';
      request.reject(new Error('Diagram bridge request expired before the browser responded.'));
      state.requests.delete(requestId);
    }
  }
  state.pending = state.pending.filter((requestId) => state.requests.has(requestId));
}

export function createDiagramAgentRequest(payload, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const state = getState();
  cleanup(state);
  if (state.pending.length >= MAX_PENDING) {
    const error = new Error('Too many pending diagram bridge requests.');
    error.code = 'BRIDGE_QUEUE_FULL';
    throw error;
  }
  const requestId = id();
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const request = {
    id: requestId,
    payload,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + Math.max(1_000, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, 5 * 60_000)),
    claimToken: null,
    resolve,
    reject,
  };
  state.requests.set(requestId, request);
  state.pending.push(requestId);
  return { id: requestId, promise };
}

export function claimDiagramAgentRequests(clientId, { limit = 4 } = {}) {
  const state = getState();
  cleanup(state);
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return [];
  const claimed = [];
  const max = Math.max(1, Math.min(Number(limit) || 1, 8));
  while (state.pending.length && claimed.length < max) {
    const requestId = state.pending.shift();
    const request = state.requests.get(requestId);
    if (!request || request.status !== 'pending') continue;
    request.status = 'claimed';
    request.clientId = normalizedClientId;
    request.claimToken = id('claim');
    claimed.push({
      id: request.id,
      payload: request.payload,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      claimToken: request.claimToken,
    });
  }
  return claimed;
}

export async function waitForDiagramAgentRequests(clientId, { limit = 4, waitMs = 20_000 } = {}) {
  const deadline = Date.now() + Math.max(0, Math.min(Number(waitMs) || 0, 25_000));
  do {
    const requests = claimDiagramAgentRequests(clientId, { limit });
    if (requests.length || Date.now() >= deadline) return requests;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (true);
}

export function resolveDiagramAgentRequest(requestId, claimToken, result, error) {
  const state = getState();
  const request = state.requests.get(String(requestId || ''));
  if (!request) return false;
  if (request.status !== 'claimed' || request.claimToken !== claimToken) return false;
  request.status = 'resolved';
  state.requests.delete(request.id);
  if (error) request.reject(error instanceof Error ? error : new Error(String(error)));
  else request.resolve(result);
  return true;
}

export function cancelDiagramAgentRequest(requestId, error = new Error('Diagram bridge request timed out.')) {
  const state = getState();
  const request = state.requests.get(String(requestId || ''));
  if (!request) return false;
  state.requests.delete(request.id);
  state.pending = state.pending.filter((id) => id !== request.id);
  request.status = 'expired';
  request.reject(error instanceof Error ? error : new Error(String(error)));
  return true;
}

export function rejectDiagramAgentRequest(requestId, claimToken, error) {
  return resolveDiagramAgentRequest(requestId, claimToken, undefined, error);
}

export function getDiagramAgentBrokerSnapshot() {
  const state = getState();
  cleanup(state);
  return {
    pending: state.pending.length,
    active: [...state.requests.values()].filter((request) => request.status === 'claimed').length,
  };
}

export const DIAGRAM_AGENT_DEFAULT_TTL_MS = DEFAULT_TTL_MS;
