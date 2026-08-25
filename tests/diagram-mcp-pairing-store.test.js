import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

test('paired tokens are workspace-scoped, hashed, long-lived, revocable, and rotatable', async () => {
  const store = new InMemoryDiagramMcpPairingStore();
  await store.registerConnection(context(), { now: 1_000 });
  const created = await store.createToken(context(), { name: 'Codex laptop', now: 1_001 });
  assert.match(created.token, /^armcp_/u);
  assert.equal(store.tokens.get(created.record.id).tokenHash.includes(created.token), false);
  assert.equal(created.record.expiresAt, null);

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

  const rotated = await store.rotateToken(reopened, created.record.id, { now: 10_000_003 });
  await assert.rejects(store.authenticateToken(created.token, { now: 10_000_004 }), { code: 'TOKEN_REVOKED' });
  assert.equal((await store.authenticateToken(rotated.token, { now: 10_000_004 })).token.id, rotated.record.id);

  await store.revokeToken(reopened, rotated.record.id, { now: 10_000_005 });
  await assert.rejects(store.authenticateToken(rotated.token, { now: 10_000_006 }), { code: 'TOKEN_REVOKED' });
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

test('file pairing store persists token hashes and workspace ownership across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchorread-pairing-'));
  const filePath = join(directory, 'pairings.json');
  try {
    const first = new FileDiagramMcpPairingStore({ filePath });
    await first.registerConnection(context(), { now: 30_000 });
    const created = await first.createToken(context(), { now: 30_001 });

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

    await second.revokeToken(reopened, created.record.id, { now: 40_002 });
    const third = new FileDiagramMcpPairingStore({ filePath });
    await assert.rejects(third.authenticateToken(created.token, { now: 40_003 }), { code: 'TOKEN_REVOKED' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
