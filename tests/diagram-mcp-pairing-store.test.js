import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  FileDiagramMcpPairingStore,
  InMemoryDiagramMcpPairingStore,
} from '../lib/diagram-mcp-pairing-store.js';

function context(overrides = {}) {
  return {
    workspaceId: 'workspace-test',
    browserSessionId: 'session-test',
    tabId: 'tab-test',
    clientId: 'client-test',
    managementSecret: 'manage-test-secret',
    href: 'https://anchor.example/diagrams',
    ...overrides,
  };
}

test('OAuth access tokens keep the approving browser binding and reject another browser session', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  assert.equal(typeof store.createToken, 'undefined');
  const registered = await store.registerConnection(context({ bindingId: 'binding-client-controlled' }), { now: 1_000 });
  assert.notEqual(registered.bindingId, 'binding-client-controlled');
  assert.match(registered.bindingId, /^binding-/u);
  const created = await store.createTokenForWorkspace(registered, {
    name: 'Codex laptop',
    clientId: 'codex-client',
    expiresInMs: 20_000_000,
    now: 1_001,
  });
  assert.match(created.token, /^armcp_/u);
  assert.equal(store.tokens.get(created.record.id).tokenHash.includes(created.token), false);
  assert.equal(created.record.expiresAt, 20_001_001);
  assert.equal(created.record.clientId, 'codex-client');

  const listed = await store.listTokensForBinding(context(), { now: 1_002 });
  assert.equal(listed.bindingId, registered.bindingId);
  assert.equal(listed.tokens[0].clientId, 'codex-client');

  const untouched = await store.revokeTokensForBinding(context(), { clientId: 'other-client', now: 1_002 });
  assert.equal(untouched.tokens.length, 0);

  const reloadedPage = context({
    tabId: 'tab-reopened',
    clientId: 'client-reopened',
  });
  const reloaded = await store.registerConnection(reloadedPage, { replace: true, now: 10_000_000 });
  assert.equal(reloaded.bindingId, registered.bindingId);
  const authenticated = await store.authenticateToken(created.token, { now: 10_000_001 });
  assert.equal(authenticated.token.id, created.record.id);
  assert.equal(authenticated.token.bindingId, registered.bindingId);
  assert.equal(authenticated.binding.workspaceId, 'workspace-test');
  assert.equal(authenticated.binding.browserSessionId, 'session-test');
  assert.equal(authenticated.binding.connected, true);

  await store.registerConnection(context({
    browserSessionId: 'session-replaced',
    tabId: 'tab-replaced',
    clientId: 'client-replaced',
  }), { replace: true, now: 10_000_002 });
  await assert.rejects(
    store.authenticateToken(created.token, { now: 10_000_003 }),
    { code: 'BROWSER_BINDING_MISMATCH' },
  );
  const revoked = await store.revokeTokensForBinding(reloadedPage, {
    clientId: 'codex-client',
    now: 10_000_004,
  });
  assert.equal(revoked.tokens.length, 1);
  await assert.rejects(store.authenticateToken(created.token, { now: 10_000_005 }), { code: 'TOKEN_REVOKED' });
});

test('file pairing store ignores deprecated non-expiring static tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchorread-static-token-'));
  const filePath = join(directory, 'pairings.json');
  const secret = 'armcp_deprecated-static-token';
  try {
    await writeFile(filePath, JSON.stringify({
      version: 1,
      workspaces: [{
        workspaceId: 'workspace-test',
        managementHash: createHash('sha256').update('manage-test-secret', 'utf8').digest('hex'),
        createdAt: 1_000,
        updatedAt: 1_000,
      }],
      tokens: [{
        id: 'token-deprecated',
        tokenHash: createHash('sha256').update(secret, 'utf8').digest('hex'),
        prefix: 'armcp_depre...oken',
        name: 'Deprecated static token',
        workspaceId: 'workspace-test',
        createdAt: 1_000,
        revokedAt: null,
        lastUsedAt: null,
        expiresAt: null,
      }],
    }), 'utf8');
    const store = new FileDiagramMcpPairingStore({ filePath });
    await assert.rejects(store.authenticateToken(secret, { now: 2_000 }), { code: 'TOKEN_UNKNOWN' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('file pairing store requires reauthorization for expiring tokens issued before strict browser binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchorread-unbound-token-'));
  const filePath = join(directory, 'pairings.json');
  const secret = 'armcp_legacy-expiring-token';
  try {
    await writeFile(filePath, JSON.stringify({
      version: 1,
      workspaces: [{
        workspaceId: 'workspace-test',
        managementHash: createHash('sha256').update('manage-test-secret', 'utf8').digest('hex'),
        createdAt: 1_000,
        updatedAt: 1_000,
      }],
      tokens: [{
        id: 'token-legacy-expiring',
        tokenHash: createHash('sha256').update(secret, 'utf8').digest('hex'),
        prefix: 'armcp_legacy...oken',
        name: 'Legacy expiring token',
        workspaceId: 'workspace-test',
        createdAt: 1_000,
        revokedAt: null,
        lastUsedAt: null,
        expiresAt: 10_000,
      }],
    }), 'utf8');
    const store = new FileDiagramMcpPairingStore({ filePath });
    await assert.rejects(
      store.authenticateToken(secret, { now: 2_000 }),
      { code: 'BROWSER_BINDING_UPGRADE_REQUIRED' },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a duplicate browser instance cannot reclaim an active session without explicit replacement', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  const registered = await store.registerConnection(context(), { now: 10_000 });
  const duplicate = context({ clientId: 'client-duplicate' });
  await assert.rejects(store.registerConnection(duplicate, { now: 10_001 }), { code: 'CONNECTION_REPLACED' });
  const otherSession = context({
    browserSessionId: 'session-blocked',
    tabId: 'tab-blocked',
    clientId: 'client-blocked',
  });
  await assert.rejects(store.registerConnection(otherSession, { now: 10_001 }), { code: 'CONNECTION_REPLACED' });
  assert.equal(store.workspaces.get('workspace-test').bindings['session-blocked'], undefined);

  const replacement = await store.registerConnection(duplicate, { replace: true, now: 10_002 });
  assert.equal(replacement.clientId, 'client-duplicate');
  assert.equal(replacement.bindingId, registered.bindingId);
  assert.equal((await store.getConnectionStatus(context(), { now: 10_003 })).status, 'replaced');
  assert.equal((await store.getConnectionStatus(duplicate, { now: 10_003 })).status, 'connected');
  await assert.rejects(store.assertConnectionOwner(context(), { now: 10_003 }), { code: 'CONNECTION_REPLACED' });
});

test('management secrets cannot inspect or mutate another workspace session', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  await store.registerConnection(context(), { now: 20_000 });
  await assert.rejects(
    store.getConnectionStatus(context({ managementSecret: 'manage-wrong-secret' }), { now: 20_001 }),
    { code: 'PAIRING_FORBIDDEN' },
  );
});

test('file pairing store persists OAuth access-token hashes and browser ownership across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchorread-pairing-'));
  const filePath = join(directory, 'pairings.json');
  try {
    const first = new FileDiagramMcpPairingStore({ filePath });
    const registered = await first.registerConnection(context(), { now: 30_000 });
    const created = await first.createTokenForWorkspace(registered, { expiresInMs: 20_000, now: 30_001 });

    const persisted = await readFile(filePath, 'utf8');
    assert.equal(persisted.includes(created.token), false);
    assert.match(persisted, /"tokenHash"/u);

    const reopened = context({
      tabId: 'tab-after-restart',
      clientId: 'client-after-restart',
    });
    const second = new FileDiagramMcpPairingStore({ filePath });
    const reconnected = await second.registerConnection(reopened, { replace: true, now: 40_000 });
    assert.equal(reconnected.bindingId, registered.bindingId);
    const authenticated = await second.authenticateToken(created.token, { now: 40_001 });
    assert.equal(authenticated.binding.browserSessionId, 'session-test');
    assert.equal(authenticated.binding.connected, true);

    const third = new FileDiagramMcpPairingStore({ filePath });
    const afterRestart = await third.authenticateToken(created.token, { now: 40_003 });
    assert.equal(afterRestart.token.id, created.record.id);
    assert.equal(afterRestart.binding.bindingId, registered.bindingId);
    assert.equal(afterRestart.binding.connected, false);
    await assert.rejects(third.authenticateToken(created.token, { now: 50_002 }), { code: 'TOKEN_EXPIRED' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('file pairing store lists and revokes authorizations for the managed browser binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchorread-pairing-revoke-'));
  const filePath = join(directory, 'pairings.json');
  try {
    const first = new FileDiagramMcpPairingStore({ filePath });
    const registered = await first.registerConnection(context(), { now: 55_000 });
    const created = await first.createTokenForWorkspace(registered, {
      name: 'Codex managed authorization',
      clientId: 'codex-managed-client',
      expiresInMs: 20_000,
      now: 55_001,
    });

    const second = new FileDiagramMcpPairingStore({ filePath });
    const listed = await second.listTokensForBinding(context(), { now: 55_002 });
    assert.equal(listed.tokens[0].clientId, 'codex-managed-client');
    const revoked = await second.revokeTokensForBinding(context(), {
      clientId: 'codex-managed-client',
      now: 55_003,
    });
    assert.equal(revoked.tokens[0].status, 'revoked');

    const third = new FileDiagramMcpPairingStore({ filePath });
    await assert.rejects(third.authenticateToken(created.token, { now: 55_004 }), { code: 'TOKEN_REVOKED' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('file pairing store refreshes persistent state shared by separate route contexts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchorread-pairing-shared-'));
  const filePath = join(directory, 'pairings.json');
  try {
    const browserRoute = new FileDiagramMcpPairingStore({ filePath });
    const tokenRoute = new FileDiagramMcpPairingStore({ filePath });
    const mcpRoute = new FileDiagramMcpPairingStore({ filePath });

    const registered = await browserRoute.registerConnection(context(), { now: 60_000 });
    const created = await tokenRoute.createTokenForWorkspace(registered, {
      name: 'Codex shared route test',
      expiresInMs: 20_000,
      now: 60_001,
    });
    const authenticated = await mcpRoute.authenticateToken(created.token, { now: 60_002 });

    assert.equal(authenticated.token.id, created.record.id);
    assert.equal(authenticated.binding.workspaceId, 'workspace-test');
    assert.equal(authenticated.binding.connected, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
