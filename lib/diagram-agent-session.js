export const DIAGRAM_AGENT_SESSION_CHANNEL = 'anchor-read:diagram-agent-session';
export const DIAGRAM_AGENT_SYNC_CHANNEL = 'anchor-read:diagram-agent-sync';
export const DIAGRAM_AGENT_TAB_STORAGE_KEY = 'anchor-read:diagram-agent-tab-id';
export const DIAGRAM_AGENT_BROWSER_SESSION_STORAGE_KEY = 'anchor-read:diagram-agent-browser-session-id';
export const DIAGRAM_AGENT_MANAGEMENT_SECRET_STORAGE_KEY = 'anchor-read:diagram-agent-management-secret';
export const DIAGRAM_AGENT_WORKSPACE_STORAGE_KEY = 'anchor-read:diagram-agent-workspace-id';
export const DIAGRAM_AGENT_LEASE_STORAGE_KEY = 'anchor-read:diagram-agent-leader';
export const DIAGRAM_AGENT_LONG_POLL_MS = 20_000;
export const DIAGRAM_AGENT_LEASE_MS = 90_000;
// Browser timers may be throttled in a background tab, so the poll loop also
// renews the lease before every request. The lease must outlive one long poll
// and tolerate Chrome's background-timer batching without handing ownership to
// another diagram tab while the current owner is still connected.
export const DIAGRAM_AGENT_LEASE_HEARTBEAT_MS = 5_000;
// Keep the server-side pairing lease alive independently of request traffic.
// This is deliberately shorter than the server connection TTL.
export const DIAGRAM_AGENT_CONNECTION_HEARTBEAT_MS = 20_000;

const IDENTITY_KEY = Symbol.for('anchor-read.diagram-agent-browser-identity');

function makeId(prefix) {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function safeStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    storage.getItem('__anchor_read_storage_probe__');
    return storage;
  } catch {
    return null;
  }
}

export function createBrowserTabId() {
  // sessionStorage is cloned by browser "Duplicate tab" actions, so a tab id
  // must be page-lifetime state rather than stored session state.
  return makeId('anchorread-tab');
}

function storedId(storage, key, prefix) {
  const usableStorage = safeStorage(storage);
  if (usableStorage) {
    try {
      const existing = String(usableStorage.getItem(key) || '').trim();
      if (existing) return existing;
      const created = makeId(prefix);
      usableStorage.setItem(key, created);
      return created;
    } catch {
      // Fall through to a page-lifetime identity when storage is unavailable.
    }
  }
  return makeId(prefix);
}

export function createBrowserWorkspaceId(storage = globalThis.localStorage) {
  return storedId(storage, DIAGRAM_AGENT_WORKSPACE_STORAGE_KEY, 'anchorread-workspace');
}

export function createBrowserSessionId(storage = globalThis.sessionStorage) {
  return storedId(storage, DIAGRAM_AGENT_BROWSER_SESSION_STORAGE_KEY, 'anchorread-session');
}

export function createBrowserManagementSecret(storage = globalThis.localStorage) {
  return storedId(storage, DIAGRAM_AGENT_MANAGEMENT_SECRET_STORAGE_KEY, 'anchorread-manage');
}

export function createDiagramAgentIdentity({
  localStorage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
} = {}) {
  if (globalThis[IDENTITY_KEY]) return globalThis[IDENTITY_KEY];
  const identity = Object.freeze({
    workspaceId: createBrowserWorkspaceId(localStorage),
    browserSessionId: createBrowserSessionId(sessionStorage),
    managementSecret: createBrowserManagementSecret(localStorage),
    tabId: createBrowserTabId(),
    clientId: makeId('anchorread-client'),
  });
  globalThis[IDENTITY_KEY] = identity;
  return identity;
}

export function resetDiagramAgentIdentityForTests() {
  delete globalThis[IDENTITY_KEY];
}

export function parseDiagramAgentLease(value) {
  if (!value || typeof value !== 'object') return null;
  const tabId = String(value.tabId || '').trim();
  const expiresAt = Number(value.expiresAt);
  if (!tabId || !Number.isFinite(expiresAt)) return null;
  return { tabId, expiresAt, acquiredAt: Number(value.acquiredAt) || 0 };
}

export function isDiagramAgentLeaseActive(lease, now = Date.now()) {
  return Boolean(lease && Number(lease.expiresAt) > now);
}

export function shouldOwnDiagramAgentLease(
  lease,
  { tabId, visible = true, now = Date.now() } = {},
) {
  // Visibility is deliberately not an ownership signal. Users may switch to a
  // different browser tab while an MCP operation is running; the stable tab id
  // remains the writer identity until the page unloads or the lease expires.
  void visible;
  if (!String(tabId || '').trim()) return false;
  return !isDiagramAgentLeaseActive(lease, now) || lease.tabId === tabId;
}

export function isDiagramAgentPageVisible(documentRef = globalThis.document) {
  return !documentRef || documentRef.visibilityState !== 'hidden';
}

function readLease(storage = globalThis.localStorage) {
  const usableStorage = safeStorage(storage);
  if (!usableStorage) return null;
  try {
    return parseDiagramAgentLease(JSON.parse(usableStorage.getItem(DIAGRAM_AGENT_LEASE_STORAGE_KEY) || 'null'));
  } catch {
    return null;
  }
}

// MCP bridge writes are restricted to the tab that owns the local lease. The
// UI itself is intentionally allowed to edit from any /diagrams page: the
// repository's revision check is the conflict boundary, not the bridge lease.
export function canPersistDiagramDrawing({
  tabId = globalThis[IDENTITY_KEY]?.tabId || '',
  storage = globalThis.localStorage,
  documentRef = globalThis.document,
  now = Date.now(),
  requireLeaseOwner = true,
} = {}) {
  void documentRef;
  if (!requireLeaseOwner) return true;
  const lease = readLease(storage);
  if (!lease || !isDiagramAgentLeaseActive(lease, now)) return true;
  const currentTabId = String(tabId || '').trim();
  return Boolean(currentTabId) && lease.tabId === currentTabId;
}

export function canPersistDiagramUiDrawing() {
  return canPersistDiagramDrawing({ requireLeaseOwner: false });
}

export function isNewerDrawing(incoming, current) {
  if (!incoming?.id) return false;
  if (!current) return true;
  const incomingRevision = Number(incoming.revision) || 0;
  const currentRevision = Number(current.revision) || 0;
  if (incomingRevision !== currentRevision) return incomingRevision > currentRevision;
  const incomingUpdatedAt = Number(incoming.updatedAt) || 0;
  const currentUpdatedAt = Number(current.updatedAt) || 0;
  return incomingUpdatedAt > currentUpdatedAt;
}

export function createDiagramAgentSession({
  tabId = createBrowserTabId(),
  storage = globalThis.localStorage,
  now = () => Date.now(),
  leaseMs = DIAGRAM_AGENT_LEASE_MS,
} = {}) {
  const usableStorage = safeStorage(storage);
  let owner = false;

  const read = () => {
    if (!usableStorage) return null;
    try {
      return parseDiagramAgentLease(JSON.parse(usableStorage.getItem(DIAGRAM_AGENT_LEASE_STORAGE_KEY) || 'null'));
    } catch {
      return null;
    }
  };

  const acquire = ({ visible = true } = {}) => {
    const timestamp = now();
    void visible;
    const current = read();
    if (!shouldOwnDiagramAgentLease(current, { tabId, visible, now: timestamp })) {
      owner = false;
      return false;
    }
    if (!usableStorage) {
      owner = true;
      return owner;
    }
    const next = { tabId, acquiredAt: timestamp, expiresAt: timestamp + Math.max(1_000, Number(leaseMs) || DIAGRAM_AGENT_LEASE_MS) };
    try {
      usableStorage.setItem(DIAGRAM_AGENT_LEASE_STORAGE_KEY, JSON.stringify(next));
      owner = read()?.tabId === tabId;
    } catch {
      owner = false;
    }
    return owner;
  };

  const release = () => {
    if (!usableStorage) {
      owner = false;
      return;
    }
    try {
      if (read()?.tabId === tabId) usableStorage.removeItem(DIAGRAM_AGENT_LEASE_STORAGE_KEY);
    } finally {
      owner = false;
    }
  };

  return Object.freeze({
    tabId,
    acquire,
    release,
    isOwner: () => owner && (!usableStorage || read()?.tabId === tabId),
    readLease: read,
  });
}

export function createDiagramSyncChannel() {
  if (typeof globalThis.BroadcastChannel !== 'function') return null;
  try {
    return new globalThis.BroadcastChannel(DIAGRAM_AGENT_SYNC_CHANNEL);
  } catch {
    return null;
  }
}
