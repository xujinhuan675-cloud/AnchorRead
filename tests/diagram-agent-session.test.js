import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIAGRAM_AGENT_LEASE_HEARTBEAT_MS,
  DIAGRAM_AGENT_LEASE_MS,
  DIAGRAM_AGENT_CONNECTION_HEARTBEAT_MS,
  DIAGRAM_AGENT_LONG_POLL_MS,
  createDiagramAgentSession,
  createDiagramAgentIdentity,
  canPersistDiagramDrawing,
  DIAGRAM_AGENT_LEASE_STORAGE_KEY,
  isDiagramAgentLeaseActive,
  isNewerDrawing,
  parseDiagramAgentLease,
  shouldOwnDiagramAgentLease,
  resetDiagramAgentIdentityForTests,
} from '../lib/diagram-agent-session.js';
import { normalizeDiagramAgentRequests } from '../lib/diagram-agent-protocol.js';
import {
  createDiagramAgentRequestTiming,
  DIAGRAM_AGENT_BRIDGE_DEFAULT_TIMEOUT_MS,
  DIAGRAM_AGENT_BRIDGE_MAX_TIMEOUT_MS,
  DIAGRAM_AGENT_REQUEST_TTL_GRACE_MS,
  normalizeDiagramAgentBridgeTimeout,
} from '../lib/diagram-agent-timing.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('diagram agent lease remains exclusive when the owner moves to the background', () => {
  const active = parseDiagramAgentLease({ tabId: 'a', expiresAt: 2_000, acquiredAt: 1_000 });
  assert.equal(isDiagramAgentLeaseActive(active, 1_500), true);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'a', visible: true, focused: true, now: 1_500 }), true);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'a', visible: true, focused: false, now: 1_500 }), true);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'b', visible: true, focused: true, now: 1_500 }), false);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'a', visible: false, focused: false, now: 1_500 }), true);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'b', visible: true, focused: true, now: 2_001 }), true);
});

test('drawing persistence allows the hidden owner but rejects a competing tab', () => {
  const storage = createStorage();
  storage.setItem(DIAGRAM_AGENT_LEASE_STORAGE_KEY, JSON.stringify({
    tabId: 'owner',
    acquiredAt: 1_000,
    expiresAt: 2_000,
  }));
  assert.equal(canPersistDiagramDrawing({
    tabId: 'owner',
    storage,
    documentRef: { visibilityState: 'visible' },
    now: 1_500,
  }), true);
  assert.equal(canPersistDiagramDrawing({
    tabId: 'other',
    storage,
    documentRef: { visibilityState: 'visible' },
    now: 1_500,
  }), false);
  assert.equal(canPersistDiagramDrawing({
    tabId: 'owner',
    storage,
    documentRef: { visibilityState: 'hidden' },
    now: 1_500,
  }), true);
  assert.equal(canPersistDiagramDrawing({
    tabId: 'other',
    storage,
    documentRef: { visibilityState: 'visible' },
    now: 2_001,
  }), true);
});

test('lease covers a complete long poll and heartbeat renews it early', () => {
  assert.ok(DIAGRAM_AGENT_LEASE_HEARTBEAT_MS > 0);
  assert.ok(DIAGRAM_AGENT_LEASE_HEARTBEAT_MS < DIAGRAM_AGENT_LEASE_MS);
  assert.ok(DIAGRAM_AGENT_LONG_POLL_MS < DIAGRAM_AGENT_LEASE_MS);
  assert.ok(DIAGRAM_AGENT_CONNECTION_HEARTBEAT_MS < 5 * 60_000);
});

test('bridge timing gives long browser work a bounded completion and result-upload window', () => {
  assert.equal(normalizeDiagramAgentBridgeTimeout(undefined), DIAGRAM_AGENT_BRIDGE_DEFAULT_TIMEOUT_MS);
  assert.equal(normalizeDiagramAgentBridgeTimeout(999_999), DIAGRAM_AGENT_BRIDGE_MAX_TIMEOUT_MS);
  assert.equal(normalizeDiagramAgentBridgeTimeout(15_000), 15_000);
  assert.deepEqual(createDiagramAgentRequestTiming({ timeoutMs: 120_000 }), {
    timeoutMs: 120_000,
    ttlMs: 120_000 + DIAGRAM_AGENT_REQUEST_TTL_GRACE_MS,
  });
});

test('session acquire and release are owner-scoped', () => {
  const storage = createStorage();
  let clock = 100;
  const first = createDiagramAgentSession({ tabId: 'first', storage, now: () => clock, leaseMs: 1_000 });
  const second = createDiagramAgentSession({ tabId: 'second', storage, now: () => clock, leaseMs: 1_000 });
  assert.equal(first.acquire(), true);
  assert.equal(second.acquire(), false);
  second.release();
  assert.equal(first.isOwner(), true);
  clock = 1_101;
  assert.equal(second.acquire(), true);
  assert.equal(first.isOwner(), false);
  first.release();
  assert.equal(second.isOwner(), true);
  second.release();
});

test('hidden session retains its writer lease until page lifecycle cleanup releases it', () => {
  const storage = createStorage();
  const session = createDiagramAgentSession({ tabId: 'tab', storage, now: () => 100, leaseMs: 1_000 });
  assert.equal(session.acquire(), true);
  assert.equal(session.acquire({ visible: false }), true);
  assert.equal(session.isOwner(), true);
  assert.equal(session.readLease()?.tabId, 'tab');
  session.release();
  assert.equal(session.isOwner(), false);
  assert.equal(session.readLease(), null);
});

test('drawing sync accepts newer revisions and timestamps only', () => {
  const current = { id: 'drawing-1', revision: 2, updatedAt: 200 };
  assert.equal(isNewerDrawing({ ...current, revision: 3, updatedAt: 201 }, current), true);
  assert.equal(isNewerDrawing({ ...current, revision: 1, updatedAt: 999 }, current), false);
  assert.equal(isNewerDrawing({ ...current, updatedAt: 199 }, current), false);
  assert.equal(isNewerDrawing({ id: 'drawing-2', revision: 1, updatedAt: 1 }, null), true);
});

test('bridge request normalization ignores malformed non-array responses', () => {
  assert.deepEqual(normalizeDiagramAgentRequests({ requests: null }), []);
  assert.deepEqual(normalizeDiagramAgentRequests({ requests: { forEach: () => { throw new Error('must not run'); } } }), []);
  assert.deepEqual(normalizeDiagramAgentRequests({ requests: [{ id: 'request-1' }] }), [{ id: 'request-1' }]);
});

test('browser identity keeps workspace stable while separating page clients', () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const first = createDiagramAgentIdentity({ localStorage, sessionStorage });
  const repeated = createDiagramAgentIdentity({ localStorage, sessionStorage });
  assert.equal(repeated, first);
  assert.match(first.workspaceId, /^anchorread-workspace-/u);
  assert.match(first.browserSessionId, /^anchorread-session-/u);
  assert.match(first.clientId, /^anchorread-client-/u);
  resetDiagramAgentIdentityForTests();
  const reloaded = createDiagramAgentIdentity({ localStorage, sessionStorage });
  assert.equal(reloaded.workspaceId, first.workspaceId);
  assert.equal(reloaded.browserSessionId, first.browserSessionId);
  assert.equal(reloaded.managementSecret, first.managementSecret);
  assert.notEqual(reloaded.tabId, first.tabId);
  assert.notEqual(reloaded.clientId, first.clientId);
  resetDiagramAgentIdentityForTests();

  const newBrowserSession = createDiagramAgentIdentity({ localStorage, sessionStorage: createStorage() });
  assert.equal(newBrowserSession.workspaceId, first.workspaceId);
  assert.equal(newBrowserSession.managementSecret, first.managementSecret);
  assert.notEqual(newBrowserSession.browserSessionId, first.browserSessionId);
  resetDiagramAgentIdentityForTests();
});
