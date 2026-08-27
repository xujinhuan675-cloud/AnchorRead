import { createHash, randomBytes } from 'node:crypto';

const STORE_KEY = Symbol.for('anchor-read.diagram-mcp-oauth-store');
const CLIENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function randomId(prefix, bytes = 24) {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

function digest(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('base64url');
}

function normalizeRedirectUri(value) {
  const uri = String(value || '').trim();
  if (!uri || uri.length > 2_000) throw oauthError('invalid_redirect_uri', 'A redirect URI is required.');
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw oauthError('invalid_redirect_uri', 'The redirect URI is not a valid URL.');
  }
  if (parsed.hash) throw oauthError('invalid_redirect_uri', 'Redirect URIs must not contain fragments.');
  const loopback = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopback) {
    throw oauthError('invalid_redirect_uri', 'Redirect URIs must use HTTPS or a loopback HTTP address.');
  }
  return parsed.toString();
}

function normalizeClientId(value) {
  const clientId = String(value || '').trim();
  if (!clientId || clientId.length > 180) throw oauthError('invalid_client', 'The client_id is invalid.');
  return clientId;
}

function normalizeScopes(value) {
  const scopes = String(value || 'diagrams:read diagrams:write')
    .split(/\s+/u)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const allowed = new Set(['diagrams:read', 'diagrams:write']);
  if (scopes.some((scope) => !allowed.has(scope))) throw oauthError('invalid_scope', 'The requested scope is not supported.');
  return [...new Set(scopes)];
}

export function oauthError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function cleanup(now = Date.now()) {
  const store = getDiagramMcpOAuthStore();
  for (const [id, client] of store.clients) {
    if (client.expiresAt <= now) store.clients.delete(id);
  }
  for (const [id, transaction] of store.transactions) {
    if (transaction.expiresAt <= now) store.transactions.delete(id);
  }
  for (const [id, code] of store.codes) {
    if (code.expiresAt <= now || code.usedAt) store.codes.delete(id);
  }
  for (const [id, refresh] of store.refreshTokens) {
    if (refresh.expiresAt <= now || refresh.revokedAt) store.refreshTokens.delete(id);
  }
}

class DiagramMcpOAuthStore {
  constructor() {
    this.clients = new Map();
    this.transactions = new Map();
    this.codes = new Map();
    this.refreshTokens = new Map();
  }

  registerClient({ redirectUris, clientName = '' } = {}, now = Date.now()) {
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 20) {
      throw oauthError('invalid_redirect_uri', 'At least one redirect URI is required.');
    }
    const normalized = [...new Set(redirectUris.map(normalizeRedirectUri))];
    cleanup(now);
    const clientId = randomId('arc');
    const client = {
      clientId,
      clientName: String(clientName || 'MCP client').trim().slice(0, 120) || 'MCP client',
      redirectUris: normalized,
      createdAt: now,
      expiresAt: now + CLIENT_TTL_MS,
    };
    this.clients.set(clientId, client);
    return { ...client };
  }

  getClient(clientId, now = Date.now()) {
    cleanup(now);
    const client = this.clients.get(normalizeClientId(clientId));
    if (!client) throw oauthError('invalid_client', 'The OAuth client is not registered.', 401);
    return client;
  }

  createTransaction({ clientId, redirectUri, codeChallenge, codeChallengeMethod = 'S256', state, scopes, resource }, now = Date.now()) {
    const client = this.getClient(clientId, now);
    const normalizedRedirect = normalizeRedirectUri(redirectUri);
    if (!client.redirectUris.includes(normalizedRedirect)) throw oauthError('invalid_request', 'The redirect URI is not registered.');
    if (codeChallengeMethod !== 'S256') throw oauthError('invalid_request', 'Only S256 PKCE is supported.');
    if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(String(codeChallenge || ''))) throw oauthError('invalid_request', 'A valid PKCE code_challenge is required.');
    const transaction = {
      id: randomId('txn'),
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri: normalizedRedirect,
      codeChallenge: String(codeChallenge),
      state: String(state || '').slice(0, 500),
      scopes: normalizeScopes(scopes),
      resource: String(resource || '').trim(),
      createdAt: now,
      expiresAt: now + TRANSACTION_TTL_MS,
    };
    cleanup(now);
    this.transactions.set(transaction.id, transaction);
    return { ...transaction };
  }

  getTransaction(id, now = Date.now()) {
    cleanup(now);
    const transaction = this.transactions.get(String(id || '').trim());
    if (!transaction) throw oauthError('invalid_request', 'The OAuth authorization request is missing or expired.');
    return transaction;
  }

  approveTransaction(id, browserContext, now = Date.now()) {
    const transaction = this.getTransaction(id, now);
    this.transactions.delete(transaction.id);
    const code = randomId('code', 32);
    this.codes.set(code, {
      code,
      ...transaction,
      browserContext: {
        workspaceId: String(browserContext?.workspaceId || '').trim(),
        browserSessionId: String(browserContext?.browserSessionId || '').trim(),
        tabId: String(browserContext?.tabId || '').trim(),
        clientId: String(browserContext?.clientId || '').trim(),
      },
      createdAt: now,
      expiresAt: now + CODE_TTL_MS,
      usedAt: 0,
    });
    const callback = new URL(transaction.redirectUri);
    callback.searchParams.set('code', code);
    if (transaction.state) callback.searchParams.set('state', transaction.state);
    return { redirectUrl: callback.toString(), clientName: transaction.clientName };
  }

  consumeCode({ code, clientId, redirectUri, codeVerifier }, now = Date.now()) {
    cleanup(now);
    const record = this.codes.get(String(code || '').trim());
    if (!record || record.usedAt || record.expiresAt <= now) throw oauthError('invalid_grant', 'The authorization code is invalid or expired.');
    if (record.clientId !== normalizeClientId(clientId)) throw oauthError('invalid_grant', 'The authorization code belongs to another client.');
    if (record.redirectUri !== normalizeRedirectUri(redirectUri)) throw oauthError('invalid_grant', 'The redirect URI does not match the authorization request.');
    if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(String(codeVerifier || ''))) throw oauthError('invalid_grant', 'A valid PKCE code_verifier is required.');
    if (digest(codeVerifier) !== record.codeChallenge) throw oauthError('invalid_grant', 'The PKCE code_verifier does not match.');
    record.usedAt = now;
    this.codes.set(record.code, record);
    return { ...record };
  }

  createRefreshToken(record, now = Date.now()) {
    const refreshToken = randomId('refresh', 32);
    this.refreshTokens.set(refreshToken, {
      token: refreshToken,
      clientId: record.clientId,
      browserContext: record.browserContext,
      scopes: record.scopes,
      createdAt: now,
      expiresAt: now + REFRESH_TTL_MS,
      revokedAt: 0,
    });
    return refreshToken;
  }

  rotateRefreshToken(value, { clientId } = {}, now = Date.now()) {
    cleanup(now);
    const record = this.refreshTokens.get(String(value || '').trim());
    if (!record || record.revokedAt || record.expiresAt <= now || record.clientId !== normalizeClientId(clientId)) {
      throw oauthError('invalid_grant', 'The refresh token is invalid or expired.');
    }
    record.revokedAt = now;
    this.refreshTokens.set(record.token, record);
    const next = this.createRefreshToken(record, now);
    return { ...record, refreshToken: next };
  }
}

export function getDiagramMcpOAuthStore() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = new DiagramMcpOAuthStore();
  return globalThis[STORE_KEY];
}

export function resetDiagramMcpOAuthStoreForTests() {
  delete globalThis[STORE_KEY];
}

export function verifyOAuthRequest({ responseType, clientId, redirectUri, codeChallenge, codeChallengeMethod, state, scope, resource } = {}) {
  if (responseType !== 'code') throw oauthError('unsupported_response_type', 'Only the authorization code flow is supported.');
  if (!clientId || !redirectUri || !codeChallenge) throw oauthError('invalid_request', 'client_id, redirect_uri and code_challenge are required.');
  if (codeChallengeMethod !== 'S256') throw oauthError('invalid_request', 'Only S256 PKCE is supported.');
  return {
    clientId: String(clientId),
    redirectUri: String(redirectUri),
    codeChallenge: String(codeChallenge),
    codeChallengeMethod,
    state: String(state || ''),
    scope: String(scope || ''),
    resource: String(resource || ''),
  };
}
