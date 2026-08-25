import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDiagramAgentSession,
  createDiagramAgentIdentity,
  isDiagramAgentLeaseActive,
  isNewerDrawing,
  parseDiagramAgentLease,
  shouldOwnDiagramAgentLease,
  resetDiagramAgentIdentityForTests,
} from '../lib/diagram-agent-session.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('diagram agent lease only belongs to a visible focused tab', () => {
  const active = parseDiagramAgentLease({ tabId: 'a', expiresAt: 2_000, acquiredAt: 1_000 });
  assert.equal(isDiagramAgentLeaseActive(active, 1_500), true);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'a', visible: true, focused: true, now: 1_500 }), true);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'a', visible: true, focused: false, now: 1_500 }), true);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'b', visible: true, focused: true, now: 1_500 }), false);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'b', visible: false, focused: true, now: 1_500 }), false);
  assert.equal(shouldOwnDiagramAgentLease(active, { tabId: 'b', visible: true, focused: true, now: 2_001 }), true);
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

test('drawing sync accepts newer revisions and timestamps only', () => {
  const current = { id: 'drawing-1', revision: 2, updatedAt: 200 };
  assert.equal(isNewerDrawing({ ...current, revision: 3, updatedAt: 201 }, current), true);
  assert.equal(isNewerDrawing({ ...current, revision: 1, updatedAt: 999 }, current), false);
  assert.equal(isNewerDrawing({ ...current, updatedAt: 199 }, current), false);
  assert.equal(isNewerDrawing({ id: 'drawing-2', revision: 1, updatedAt: 1 }, null), true);
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
