import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  getDiagramMcpOAuthStore,
  resetDiagramMcpOAuthStoreForTests,
} from '../lib/diagram-mcp-oauth.js';
import { InMemoryDiagramMcpPairingStore } from '../lib/diagram-mcp-pairing-store.js';

function challenge(verifier) {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

test('OAuth dynamic registration and PKCE authorization codes are one-time', () => {
  resetDiagramMcpOAuthStoreForTests();
  const store = getDiagramMcpOAuthStore();
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
  resetDiagramMcpOAuthStoreForTests();
});

test('OAuth rejects unregistered redirects and a mismatched PKCE verifier', () => {
  resetDiagramMcpOAuthStoreForTests();
  const store = getDiagramMcpOAuthStore();
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
  resetDiagramMcpOAuthStoreForTests();
});

test('OAuth-issued access tokens expire while legacy pairing tokens remain long-lived', async () => {
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
