const BROKER_KEY = Symbol.for('anchor-read.diagram-agent-broker');
const MAX_PENDING = 32;
const DEFAULT_TTL_MS = 60_000;
const CLIENT_TTL_MS = 12_000;

function getState() {
  if (!globalThis[BROKER_KEY]) {
    globalThis[BROKER_KEY] = {
      requests: new Map(),
      pending: [],
      clients: new Map(),
      nextClientSequence: 0,
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
  for (const [clientId, client] of state.clients) {
    if (client.expiresAt <= now) state.clients.delete(clientId);
  }
}

export function registerDiagramAgentClient(clientId, {
  tabId = '',
  workspaceId = '',
  browserSessionId = '',
  visible = true,
  focused = true,
  href = '',
  now = Date.now(),
} = {}) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return null;
  const state = getState();
  cleanup(state, now);
  const client = {
    clientId: normalizedClientId,
    tabId: String(tabId || normalizedClientId).trim(),
    workspaceId: String(workspaceId || '').trim(),
    browserSessionId: String(browserSessionId || '').trim(),
    visible: Boolean(visible),
    focused: Boolean(focused),
    href: String(href || '').slice(0, 500),
    seenAt: now,
    seenSequence: ++state.nextClientSequence,
    expiresAt: now + CLIENT_TTL_MS,
  };
  state.clients.set(normalizedClientId, client);
  return client;
}

export function unregisterDiagramAgentClient(clientId) {
  const state = getState();
  return state.clients.delete(String(clientId || '').trim());
}

function selectActiveClient(state, request, now = Date.now()) {
  const clients = [...state.clients.values()].filter((client) => (
    client.expiresAt > now && requestTargetsClient(request, client)
  ));
  const focused = clients
    .filter((client) => client.visible && client.focused)
    .sort((left, right) => (
      right.seenAt - left.seenAt || right.seenSequence - left.seenSequence
    ));
  if (focused[0]) return focused[0];
  return clients
    .filter((client) => client.visible)
    .sort((left, right) => (
      right.seenAt - left.seenAt || right.seenSequence - left.seenSequence
    ))[0] || null;
}

function requestTargetsClient(request, client) {
  const targetClientId = String(request.scope?.clientId || '').trim();
  const targetTabId = String(request.scope?.tabId || '').trim();
  const targetWorkspaceId = String(request.scope?.workspaceId || '').trim();
  const targetBrowserSessionId = String(request.scope?.browserSessionId || '').trim();
  if (targetClientId && targetClientId !== client.clientId) return false;
  if (targetTabId && targetTabId !== client.tabId) return false;
  if (targetWorkspaceId && targetWorkspaceId !== client.workspaceId) return false;
  if (targetBrowserSessionId && targetBrowserSessionId !== client.browserSessionId) return false;
  return true;
}

export function createDiagramAgentRequest(payload, {
  ttlMs = DEFAULT_TTL_MS,
  scope = null,
  tokenId = '',
} = {}) {
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
    scope: scope ? {
      workspaceId: String(scope.workspaceId || '').trim(),
      browserSessionId: String(scope.browserSessionId || '').trim(),
      tabId: String(scope.tabId || '').trim(),
      clientId: String(scope.clientId || '').trim(),
    } : null,
    tokenId: String(tokenId || '').trim(),
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

export function claimDiagramAgentRequests(clientId, { limit = 4, client = {} } = {}) {
  const state = getState();
  cleanup(state);
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return [];
  const registered = registerDiagramAgentClient(normalizedClientId, client);
  if (!registered.visible) return [];
  const claimed = [];
  const max = Math.max(1, Math.min(Number(limit) || 1, 8));
  let remaining = state.pending.length;
  while (remaining > 0 && state.pending.length && claimed.length < max) {
    remaining -= 1;
    const requestId = state.pending.shift();
    const request = state.requests.get(requestId);
    if (!request || request.status !== 'pending') continue;
    if (!requestTargetsClient(request, registered)) {
      state.pending.push(requestId);
      continue;
    }
    const active = selectActiveClient(state, request);
    if (active && active.clientId !== registered.clientId) {
      state.pending.push(requestId);
      continue;
    }
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

export async function waitForDiagramAgentRequests(clientId, { limit = 4, waitMs = 20_000, client = {} } = {}) {
  const deadline = Date.now() + Math.max(0, Math.min(Number(waitMs) || 0, 25_000));
  do {
    const requests = claimDiagramAgentRequests(clientId, { limit, client });
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

export function cancelDiagramAgentRequestsForToken(tokenId, error = new Error('Remote MCP token was revoked.')) {
  const normalizedTokenId = String(tokenId || '').trim();
  if (!normalizedTokenId) return 0;
  const state = getState();
  let cancelled = 0;
  for (const request of [...state.requests.values()]) {
    if (request.tokenId !== normalizedTokenId) continue;
    if (cancelDiagramAgentRequest(request.id, error)) cancelled += 1;
  }
  return cancelled;
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
    clients: [...state.clients.values()].map((client) => ({ ...client })),
  };
}

export function resetDiagramAgentBrokerForTests() {
  delete globalThis[BROKER_KEY];
}

export const DIAGRAM_AGENT_DEFAULT_TTL_MS = DEFAULT_TTL_MS;
