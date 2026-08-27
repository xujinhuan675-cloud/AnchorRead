import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DiagramMcpOAuthStore,
  FileDiagramMcpOAuthStore,
  redirectUriMatches,
} from '../lib/diagram-mcp-oauth.js';
import { InMemoryDiagramMcpPairingStore } from '../lib/diagram-mcp-pairing-store.js';

function challenge(verifier) {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

test('OAuth dynamic registration and PKCE authorization codes are one-time', () => {
  const store = new DiagramMcpOAuthStore();
  const verifier = 'anchorread-oauth-verifier-abcdefghijklmnopqrstuvwxyz0123456789';
  const client = store.registerClient({
    clientName: 'Codex test',
    redirectUris: ['http://127.0.0.1:4567/callback'],
  }, 1_000);
  const transaction = store.createTransaction({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0],
    codeChallenge: challenge(verifier),
    codeChallengeMethod: 'S256',
    state: 'state-123',
    scopes: 'diagrams:read diagrams:write',
  }, 2_000);
  const approved = store.approveTransaction(transaction.id, {
    workspaceId: 'workspace-oauth',
    browserSessionId: 'session-oauth',
    tabId: 'tab-oauth',
    clientId: 'browser-oauth',
  }, 3_000);
  const callback = new URL(approved.redirectUrl);
  assert.equal(callback.origin, 'http://127.0.0.1:4567');
  assert.equal(callback.searchParams.get('state'), 'state-123');
  const code = callback.searchParams.get('code');
  const consumed = store.consumeCode({
    code,
    clientId: client.clientId,
    redirectUri: client.redirectUris[0],
    codeVerifier: verifier,
  }, 4_000);
  assert.equal(consumed.browserContext.workspaceId, 'workspace-oauth');
  assert.throws(() => store.consumeCode({
    code,
    clientId: client.clientId,
    redirectUri: client.redirectUris[0],
    codeVerifier: verifier,
  }, 4_001), /invalid or expired/u);
});

test('OAuth rejects unregistered redirects and a mismatched PKCE verifier', () => {
  const store = new DiagramMcpOAuthStore();
  const verifier = 'anchorread-second-verifier-abcdefghijklmnopqrstuvwxyz0123456789';
  const client = store.registerClient({ redirectUris: ['https://client.example/callback'] }, 1_000);
  assert.throws(() => store.createTransaction({
    clientId: client.clientId,
    redirectUri: 'https://evil.example/callback',
    codeChallenge: challenge(verifier),
    codeChallengeMethod: 'S256',
  }, 2_000), /not registered/u);
  const transaction = store.createTransaction({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0],
    codeChallenge: challenge(verifier),
    codeChallengeMethod: 'S256',
  }, 2_000);
  const approved = store.approveTransaction(transaction.id, { workspaceId: 'workspace-oauth' }, 3_000);
  assert.throws(() => store.consumeCode({
    code: new URL(approved.redirectUrl).searchParams.get('code'),
    clientId: client.clientId,
    redirectUri: client.redirectUris[0],
    codeVerifier: `${verifier.slice(0, -1)}x`,
  }, 4_000), /does not match/u);
});

test('OAuth loopback redirects may change only their ephemeral port', () => {
  const registered = 'http://127.0.0.1:43123/callback/uKcZNpVb4c62';
  assert.equal(redirectUriMatches(registered, 'http://127.0.0.1:11791/callback/uKcZNpVb4c62'), true);
  assert.equal(redirectUriMatches(registered, 'http://localhost:11791/callback/uKcZNpVb4c62'), false);
  assert.equal(redirectUriMatches(registered, 'http://127.0.0.1:11791/callback/other'), false);
  assert.equal(redirectUriMatches(registered, 'https://client.example/callback/uKcZNpVb4c62'), false);
  assert.equal(redirectUriMatches('https://client.example:443/callback', 'https://client.example:444/callback'), false);
});

test('file OAuth store survives restarts without persisting raw codes or refresh tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anchorread-oauth-'));
  const filePath = join(directory, 'oauth.json');
  const verifier = 'anchorread-persistent-verifier-abcdefghijklmnopqrstuvwxyz0123456789';
  try {
    const first = new FileDiagramMcpOAuthStore({ filePath });
    const client = first.registerClient({
      clientName: 'Codex persistent test',
      redirectUris: ['http://127.0.0.1:43123/callback/uKcZNpVb4c62'],
    }, 1_000);
    const transaction = first.createTransaction({
      clientId: client.clientId,
      redirectUri: 'http://127.0.0.1:11791/callback/uKcZNpVb4c62',
      codeChallenge: challenge(verifier),
      codeChallengeMethod: 'S256',
      scopes: 'diagrams:read diagrams:write',
    }, 2_000);

    const second = new FileDiagramMcpOAuthStore({ filePath });
    assert.equal(second.getTransaction(transaction.id, 2_001).clientId, client.clientId);
    const approved = second.approveTransaction(transaction.id, { workspaceId: 'browser-persistent' }, 3_000);
    const code = new URL(approved.redirectUrl).searchParams.get('code');

    const third = new FileDiagramMcpOAuthStore({ filePath });
    const record = third.consumeCode({
      code,
      clientId: client.clientId,
      redirectUri: 'http://127.0.0.1:11791/callback/uKcZNpVb4c62',
      codeVerifier: verifier,
    }, 4_000);
    const refreshToken = third.createRefreshToken(record, 4_001);
    const persisted = await readFile(filePath, 'utf8');
    assert.equal(persisted.includes(code), false);
    assert.equal(persisted.includes(refreshToken), false);
    assert.match(persisted, /"tokenHash"/u);

    const fourth = new FileDiagramMcpOAuthStore({ filePath });
    const rotated = fourth.rotateRefreshToken(refreshToken, { clientId: client.clientId }, 5_000);
    assert.match(rotated.refreshToken, /^refresh_/u);
    assert.throws(() => fourth.rotateRefreshToken(refreshToken, { clientId: client.clientId }, 5_001), /invalid or expired/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('OAuth-issued access tokens expire', async () => {
  const pairing = new InMemoryDiagramMcpPairingStore();
  const context = {
    workspaceId: 'workspace-expiry',
    browserSessionId: 'session-expiry',
    tabId: 'tab-expiry',
    clientId: 'browser-expiry',
    managementSecret: 'management-expiry',
  };
  await pairing.registerConnection(context, { now: 1_000 });
  const issued = await pairing.createTokenForWorkspace(context, { expiresInMs: 100, now: 1_000 });
  assert.equal(issued.record.expiresAt, 1_100);
  await assert.rejects(() => pairing.authenticateToken(issued.token, { now: 1_101 }), /expired/u);
});
