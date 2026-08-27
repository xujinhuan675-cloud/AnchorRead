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

test('OAuth access tokens are browser-scoped, hashed, expiring, and follow a reopened page', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  assert.equal(typeof store.createToken, 'undefined');
  await store.registerConnection(context(), { now: 1_000 });
  const created = await store.createTokenForWorkspace(context(), {
    name: 'Codex laptop',
    expiresInMs: 20_000_000,
    now: 1_001,
  });
  assert.match(created.token, /^armcp_/u);
  assert.equal(store.tokens.get(created.record.id).tokenHash.includes(created.token), false);
  assert.equal(created.record.expiresAt, 20_001_001);

  const reopened = context({
    browserSessionId: 'session-reopened',
    tabId: 'tab-reopened',
    clientId: 'client-reopened',
  });
  await store.registerConnection(reopened, { replace: true, now: 10_000_000 });
  const authenticated = await store.authenticateToken(created.token, { now: 10_000_001 });
  assert.equal(authenticated.token.id, created.record.id);
  assert.equal(authenticated.binding.workspaceId, 'workspace-test');
  assert.equal(authenticated.binding.browserSessionId, 'session-reopened');
  assert.equal(authenticated.binding.connected, true);
  await assert.rejects(store.authenticateToken(created.token, { now: 20_001_002 }), { code: 'TOKEN_EXPIRED' });
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

test('a duplicate browser instance cannot reclaim an active session without explicit replacement', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  await store.registerConnection(context(), { now: 10_000 });
  const duplicate = context({ clientId: 'client-duplicate' });
  await assert.rejects(store.registerConnection(duplicate, { now: 10_001 }), { code: 'CONNECTION_REPLACED' });

  const replacement = await store.registerConnection(duplicate, { replace: true, now: 10_002 });
  assert.equal(replacement.clientId, 'client-duplicate');
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
    await first.registerConnection(context(), { now: 30_000 });
    const created = await first.createTokenForWorkspace(context(), { expiresInMs: 20_000, now: 30_001 });

    const persisted = await readFile(filePath, 'utf8');
    assert.equal(persisted.includes(created.token), false);
    assert.match(persisted, /"tokenHash"/u);

    const reopened = context({
      browserSessionId: 'session-after-restart',
      tabId: 'tab-after-restart',
      clientId: 'client-after-restart',
    });
    const second = new FileDiagramMcpPairingStore({ filePath });
    await second.registerConnection(reopened, { replace: true, now: 40_000 });
    const authenticated = await second.authenticateToken(created.token, { now: 40_001 });
    assert.equal(authenticated.binding.browserSessionId, 'session-after-restart');

    const third = new FileDiagramMcpPairingStore({ filePath });
    assert.equal((await third.authenticateToken(created.token, { now: 40_003 })).token.id, created.record.id);
    await assert.rejects(third.authenticateToken(created.token, { now: 50_002 }), { code: 'TOKEN_EXPIRED' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
