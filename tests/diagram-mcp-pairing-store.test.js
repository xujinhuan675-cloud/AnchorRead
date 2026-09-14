import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DIAGRAM_MCP_CONNECTION_TTL_MS,
  FileDiagramMcpPairingStore,
  InMemoryDiagramMcpPairingStore,
} from '../lib/diagram-mcp-pairing-store.js';
import { getDiagramAgentBuildInfo } from '../lib/diagram-agent-protocol.js';

function context(overrides = {}) {
  return {
    workspaceId: 'workspace-test',
    browserSessionId: 'session-test',
    tabId: 'tab-test',
    clientId: 'client-test',
    managementSecret: 'manage-test-secret',
    href: 'https://anchor.example/diagrams',
    ...getDiagramAgentBuildInfo(),
    ...overrides,
  };
}

test('browser pairing lease leaves enough time for background tabs between heartbeats', async () => {
  assert.ok(DIAGRAM_MCP_CONNECTION_TTL_MS >= 5 * 60_000);
  const store = new InMemoryDiagramMcpPairingStore();
  const registered = await store.registerConnection(context(), { now: 100 });
  assert.equal(registered.expiresAt, 100 + DIAGRAM_MCP_CONNECTION_TTL_MS);
  const renewed = await store.registerConnection(context(), { now: 20_000 });
  assert.equal(renewed.expiresAt, 20_000 + DIAGRAM_MCP_CONNECTION_TTL_MS);
});

test('connection generations fence delayed disconnects after same-client reconnects', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  const initial = await store.registerConnection(context(), { now: 150 });
  const reconnected = await store.registerConnection(context(), { replace: true, now: 200 });
  assert.equal(reconnected.generation, initial.generation + 1);
  assert.equal(await store.disconnectConnection({ ...context(), generation: initial.generation }, { now: 201 }), false);
  assert.equal((await store.getConnectionStatus(context(), { now: 202 })).connected, true);
  assert.equal(await store.disconnectConnection({ ...context(), generation: reconnected.generation }, { now: 203 }), true);
  assert.equal((await store.getConnectionStatus(context(), { now: 204 })).connected, false);
});

test('browser build handshake accepts current, rejects missing and stale versions, then recovers after refresh', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  const current = await store.registerConnection(context(), { now: 100 });
  assert.equal(current.connected, true);
  assert.equal(current.writable, true);
  assert.equal(current.versionCompatible, true);

  const missingContext = context({
    browserSessionId: 'session-missing',
    tabId: 'tab-missing',
    clientId: 'client-missing',
    buildSha: '',
    buildVersion: '',
    protocolVersion: '',
  });
  const missing = await store.registerConnection(missingContext, { replace: true, now: 200 });
  assert.equal(missing.online, true);
  assert.equal(missing.connected, false);
  assert.equal(missing.status, 'stale');
  await assert.rejects(store.assertConnectionOwner(missingContext, { now: 201 }), (error) => {
    assert.equal(error.code, 'BROWSER_BUILD_STALE');
    assert.deepEqual(error.missing.sort(), ['buildSha', 'buildVersion', 'protocolVersion']);
    assert.equal(error.recovery.action, 'refresh_workspace_page');
    return true;
  });

  const staleContext = context({
    browserSessionId: 'session-stale',
    tabId: 'tab-stale',
    clientId: 'client-stale',
    protocolVersion: '1',
  });
  const stale = await store.registerConnection(staleContext, { replace: true, now: 300 });
  assert.equal(stale.status, 'stale');
  assert.deepEqual(stale.expected, getDiagramAgentBuildInfo());
  assert.equal(stale.actual.protocolVersion, '1');

  const refreshedContext = context({
    browserSessionId: 'session-stale',
    tabId: 'tab-refreshed',
    clientId: 'client-refreshed',
  });
  const refreshed = await store.registerConnection(refreshedContext, { replace: true, now: 400 });
  assert.equal(refreshed.connected, true);
  assert.equal(refreshed.writable, true);
  assert.equal((await store.assertConnectionOwner(refreshedContext, { now: 401 })).status, 'connected');
});

test('OAuth access tokens follow the browser workspace across tab sessions', async () => {
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

  const replacement = await store.registerConnection(context({
    browserSessionId: 'session-replaced',
    tabId: 'tab-replaced',
    clientId: 'client-replaced',
  }), { replace: true, now: 10_000_002 });
  const moved = await store.authenticateToken(created.token, { now: 10_000_003 });
  assert.equal(moved.binding.browserSessionId, 'session-replaced');
  assert.equal(moved.binding.bindingId, replacement.bindingId);
  assert.equal(moved.binding.connected, true);
  const revoked = await store.revokeTokensForBinding(reloadedPage, {
    clientId: 'codex-client',
    now: 10_000_004,
  });
  assert.equal(revoked.tokens.length, 1);
  assert.deepEqual((await store.listTokensForBinding(reloadedPage, { now: 10_000_005 })).tokens, []);
  await assert.rejects(store.authenticateToken(created.token, { now: 10_000_006 }), { code: 'TOKEN_UNKNOWN' });
});

test('personal token is long-lived, browser-bound, and only one active credential is kept', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  const registered = await store.registerConnection(context(), { now: 2_000 });
  const created = await store.createPersonalTokenForWorkspace(context(), { now: 2_001 });
  assert.match(created.token, /^armcp_/u);
  assert.equal(created.record.kind, 'personal');
  assert.equal(created.record.expiresAt, null);
  assert.equal(store.tokens.get(created.record.id).tokenHash.includes(created.token), false);

  const authenticated = await store.authenticateToken(created.token, { now: 10_000 });
  assert.equal(authenticated.token.kind, 'personal');
  assert.equal(authenticated.binding.bindingId, registered.bindingId);
  assert.equal(authenticated.binding.connected, true);

  const replacement = await store.createPersonalTokenForWorkspace(context(), { now: 10_001 });
  assert.notEqual(replacement.token, created.token);
  await assert.rejects(store.authenticateToken(created.token, { now: 10_002 }), { code: 'TOKEN_UNKNOWN' });
  const listed = await store.listTokensForBinding(context(), { now: 10_003 });
  assert.equal(listed.tokens.length, 1);
  assert.equal(listed.tokens[0].id, replacement.record.id);
});

test('file pairing store persists personal token records and rejects legacy static tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchorread-personal-token-'));
  const filePath = join(directory, 'pairings.json');
  try {
    const first = new FileDiagramMcpPairingStore({ filePath });
    await first.registerConnection(context(), { now: 3_000 });
    const created = await first.createPersonalTokenForWorkspace(context(), { now: 3_001 });
    const persisted = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(persisted.tokens[0].kind, 'personal');
    assert.equal(persisted.tokens[0].expiresAt, null);

    const reopened = new FileDiagramMcpPairingStore({ filePath });
    const authenticated = await reopened.authenticateToken(created.token, { now: 3_002 });
    assert.equal(authenticated.token.kind, 'personal');
    assert.equal(authenticated.token.expiresAt, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('OAuth approval reuses the online browser connection without registering its temporary tab', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  const online = await store.registerConnection(context(), { now: 12_000 });
  const approvalPage = context({
    browserSessionId: 'session-oauth-window',
    tabId: 'tab-oauth-window',
    clientId: 'client-oauth-window',
    href: 'https://anchor.example/diagrams?mcp=oauth_approve',
  });

  const binding = await store.ensureBrowserBinding(approvalPage, { now: 12_001 });

  assert.equal(binding.bindingId, online.bindingId);
  assert.equal(binding.browserSessionId, online.browserSessionId);
  assert.equal(binding.tabId, online.tabId);
  assert.equal(binding.connected, true);
  assert.equal(store.workspaces.get('workspace-test').bindings['session-oauth-window'], undefined);
  assert.equal((await store.getConnectionStatus(context(), { now: 12_002 })).status, 'connected');
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

test('file pairing store lists and revokes authorizations for the managed browser workspace', async () => {
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
    assert.deepEqual((await second.listTokensForBinding(context(), { now: 55_004 })).tokens, []);

    const third = new FileDiagramMcpPairingStore({ filePath });
    assert.deepEqual((await third.listTokensForBinding(context(), { now: 55_005 })).tokens, []);
    await assert.rejects(third.authenticateToken(created.token, { now: 55_006 }), { code: 'TOKEN_UNKNOWN' });
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
