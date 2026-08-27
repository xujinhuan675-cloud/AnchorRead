import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const STORE_KEY = Symbol.for('anchor-read.diagram-mcp-oauth-store');
const STORE_OVERRIDE_KEY = Symbol.for('anchor-read.diagram-mcp-oauth-store-override');
const CLIENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const STORE_VERSION = 1;

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

function isLoopbackHttpUrl(url) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/**
 * Native OAuth clients may reuse a registration while selecting a new
 * ephemeral loopback port. Every other redirect component must stay exact.
 */
export function redirectUriMatches(registeredValue, requestedValue) {
  const registered = new URL(normalizeRedirectUri(registeredValue));
  const requested = new URL(normalizeRedirectUri(requestedValue));
  if (registered.toString() === requested.toString()) return true;
  return isLoopbackHttpUrl(registered)
    && isLoopbackHttpUrl(requested)
    && registered.hostname === requested.hostname
    && registered.username === requested.username
    && registered.password === requested.password
    && registered.pathname === requested.pathname
    && registered.search === requested.search;
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

function defaultStorePath() {
  const configured = String(process.env.ANCHORREAD_MCP_OAUTH_STORE_PATH || '').trim();
  return resolve(configured || join(process.cwd(), '.anchorread-data', 'diagram-mcp-oauth.json'));
}

function isMemoryStoreConfigured() {
  return String(process.env.ANCHORREAD_MCP_OAUTH_STORE || '').trim().toLowerCase() === 'memory';
}

export class DiagramMcpOAuthStore {
  constructor() {
    this.clients = new Map();
    this.transactions = new Map();
    this.codes = new Map();
    this.refreshTokens = new Map();
    this.runtimeInfo = { oauthStore: 'memory', persistentOAuth: false };
  }

  commit() {}

  cleanup(now = Date.now()) {
    let changed = false;
    for (const [id, client] of this.clients) {
      if (client.expiresAt <= now) {
        this.clients.delete(id);
        changed = true;
      }
    }
    for (const [id, transaction] of this.transactions) {
      if (transaction.expiresAt <= now) {
        this.transactions.delete(id);
        changed = true;
      }
    }
    for (const [id, code] of this.codes) {
      if (code.expiresAt <= now) {
        this.codes.delete(id);
        changed = true;
      }
    }
    for (const [id, refresh] of this.refreshTokens) {
      if (refresh.expiresAt <= now) {
        this.refreshTokens.delete(id);
        changed = true;
      }
    }
    if (changed) this.commit();
  }

  registerClient({ redirectUris, clientName = '' } = {}, now = Date.now()) {
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 20) {
      throw oauthError('invalid_redirect_uri', 'At least one redirect URI is required.');
    }
    const normalized = [...new Set(redirectUris.map(normalizeRedirectUri))];
    this.cleanup(now);
    const clientId = randomId('arc');
    const client = {
      clientId,
      clientName: String(clientName || 'MCP client').trim().slice(0, 120) || 'MCP client',
      redirectUris: normalized,
      createdAt: now,
      expiresAt: now + CLIENT_TTL_MS,
    };
    this.clients.set(clientId, client);
    this.commit();
    return { ...client };
  }

  getClient(clientId, now = Date.now()) {
    this.cleanup(now);
    const client = this.clients.get(normalizeClientId(clientId));
    if (!client) throw oauthError('invalid_client', 'The OAuth client is not registered.', 401);
    return client;
  }

  validateRedirectUri(client, redirectUri) {
    const normalized = normalizeRedirectUri(redirectUri);
    if (!client.redirectUris.some((registered) => redirectUriMatches(registered, normalized))) {
      throw oauthError('invalid_request', 'The redirect URI is not registered.');
    }
    return normalized;
  }

  createTransaction({ clientId, redirectUri, codeChallenge, codeChallengeMethod = 'S256', state, scopes, resource }, now = Date.now()) {
    const client = this.getClient(clientId, now);
    const normalizedRedirect = this.validateRedirectUri(client, redirectUri);
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
    this.cleanup(now);
    this.transactions.set(transaction.id, transaction);
    this.commit();
    return { ...transaction };
  }

  getTransaction(id, now = Date.now()) {
    this.cleanup(now);
    const transaction = this.transactions.get(String(id || '').trim());
    if (!transaction) throw oauthError('invalid_request', 'The OAuth authorization request is missing or expired.');
    return transaction;
  }

  approveTransaction(id, browserContext, now = Date.now()) {
    const transaction = this.getTransaction(id, now);
    this.transactions.delete(transaction.id);
    const code = randomId('code', 32);
    const codeHash = digest(code);
    this.codes.set(codeHash, {
      codeHash,
      ...transaction,
      browserContext: {
        workspaceId: String(browserContext?.workspaceId || '').trim(),
        browserSessionId: String(browserContext?.browserSessionId || '').trim(),
        tabId: String(browserContext?.tabId || '').trim(),
        clientId: String(browserContext?.clientId || '').trim(),
      },
      createdAt: now,
      expiresAt: now + CODE_TTL_MS,
    });
    this.commit();
    const callback = new URL(transaction.redirectUri);
    callback.searchParams.set('code', code);
    if (transaction.state) callback.searchParams.set('state', transaction.state);
    return { redirectUrl: callback.toString(), clientName: transaction.clientName };
  }

  consumeCode({ code, clientId, redirectUri, codeVerifier }, now = Date.now()) {
    this.cleanup(now);
    const codeHash = digest(String(code || '').trim());
    const record = this.codes.get(codeHash);
    if (!record || record.expiresAt <= now) throw oauthError('invalid_grant', 'The authorization code is invalid or expired.');
    if (record.clientId !== normalizeClientId(clientId)) throw oauthError('invalid_grant', 'The authorization code belongs to another client.');
    if (record.redirectUri !== normalizeRedirectUri(redirectUri)) throw oauthError('invalid_grant', 'The redirect URI does not match the authorization request.');
    if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(String(codeVerifier || ''))) throw oauthError('invalid_grant', 'A valid PKCE code_verifier is required.');
    if (digest(codeVerifier) !== record.codeChallenge) throw oauthError('invalid_grant', 'The PKCE code_verifier does not match.');
    this.codes.delete(codeHash);
    this.commit();
    return { ...record };
  }

  createRefreshToken(record, now = Date.now()) {
    const refreshToken = randomId('refresh', 32);
    const tokenHash = digest(refreshToken);
    this.refreshTokens.set(tokenHash, {
      tokenHash,
      clientId: record.clientId,
      browserContext: record.browserContext,
      scopes: record.scopes,
      createdAt: now,
      expiresAt: now + REFRESH_TTL_MS,
    });
    this.commit();
    return refreshToken;
  }

  rotateRefreshToken(value, { clientId } = {}, now = Date.now()) {
    this.cleanup(now);
    const tokenHash = digest(String(value || '').trim());
    const record = this.refreshTokens.get(tokenHash);
    if (!record || record.expiresAt <= now || record.clientId !== normalizeClientId(clientId)) {
      throw oauthError('invalid_grant', 'The refresh token is invalid or expired.');
    }
    this.refreshTokens.delete(tokenHash);
    const next = this.createRefreshToken(record, now);
    return { ...record, refreshToken: next };
  }
}

export class FileDiagramMcpOAuthStore extends DiagramMcpOAuthStore {
  constructor({ filePath = defaultStorePath() } = {}) {
    super();
    this.filePath = resolve(filePath);
    this.loading = true;
    this.operationDepth = 0;
    this.runtimeInfo = { oauthStore: 'file', persistentOAuth: true };
    this.load();
    this.loading = false;
  }

  load() {
    let raw;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.clients = new Map();
        this.transactions = new Map();
        this.codes = new Map();
        this.refreshTokens = new Map();
        return;
      }
      throw oauthError('server_error', `Cannot read the MCP OAuth store at ${this.filePath}.`, 500);
    }
    try {
      const data = JSON.parse(raw);
      if (data?.version !== STORE_VERSION) throw new Error(`Unsupported store version: ${data?.version}`);
      const clients = new Map();
      const transactions = new Map();
      const codes = new Map();
      const refreshTokens = new Map();
      for (const client of data.clients || []) {
        if (client?.clientId && Array.isArray(client.redirectUris)) clients.set(client.clientId, client);
      }
      for (const transaction of data.transactions || []) {
        if (transaction?.id) transactions.set(transaction.id, transaction);
      }
      for (const code of data.codes || []) {
        if (code?.codeHash) codes.set(code.codeHash, code);
      }
      for (const refresh of data.refreshTokens || []) {
        if (refresh?.tokenHash) refreshTokens.set(refresh.tokenHash, refresh);
      }
      this.clients = clients;
      this.transactions = transactions;
      this.codes = codes;
      this.refreshTokens = refreshTokens;
    } catch {
      throw oauthError('server_error', `The MCP OAuth store at ${this.filePath} is invalid.`, 500);
    }
  }

  runFresh(operation) {
    const outermost = this.operationDepth === 0;
    if (outermost && !this.loading) this.load();
    this.operationDepth += 1;
    try {
      return operation();
    } finally {
      this.operationDepth -= 1;
    }
  }

  registerClient(options, now) {
    return this.runFresh(() => super.registerClient(options, now));
  }

  getClient(clientId, now) {
    return this.runFresh(() => super.getClient(clientId, now));
  }

  createTransaction(request, now) {
    return this.runFresh(() => super.createTransaction(request, now));
  }

  getTransaction(id, now) {
    return this.runFresh(() => super.getTransaction(id, now));
  }

  approveTransaction(id, browserContext, now) {
    return this.runFresh(() => super.approveTransaction(id, browserContext, now));
  }

  consumeCode(request, now) {
    return this.runFresh(() => super.consumeCode(request, now));
  }

  createRefreshToken(record, now) {
    return this.runFresh(() => super.createRefreshToken(record, now));
  }

  rotateRefreshToken(value, options, now) {
    return this.runFresh(() => super.rotateRefreshToken(value, options, now));
  }

  commit() {
    if (this.loading) return;
    const payload = JSON.stringify({
      version: STORE_VERSION,
      clients: [...this.clients.values()],
      transactions: [...this.transactions.values()],
      codes: [...this.codes.values()],
      refreshTokens: [...this.refreshTokens.values()],
    }, null, 2);
    const temporaryPath = `${this.filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporaryPath, this.filePath);
    } catch {
      try { rmSync(temporaryPath, { force: true }); } catch {}
      throw oauthError('server_error', `Cannot persist the MCP OAuth store at ${this.filePath}.`, 500);
    }
  }
}

export function getDiagramMcpOAuthStore() {
  if (globalThis[STORE_OVERRIDE_KEY]) return globalThis[STORE_OVERRIDE_KEY];
  if (!globalThis[STORE_KEY]) {
    globalThis[STORE_KEY] = isMemoryStoreConfigured()
      ? new DiagramMcpOAuthStore()
      : new FileDiagramMcpOAuthStore();
  }
  return globalThis[STORE_KEY];
}

export function setDiagramMcpOAuthStore(store) {
  globalThis[STORE_OVERRIDE_KEY] = store || null;
}

export function getDiagramMcpOAuthRuntimeInfo() {
  return globalThis[STORE_OVERRIDE_KEY]?.runtimeInfo
    || globalThis[STORE_KEY]?.runtimeInfo
    || (isMemoryStoreConfigured()
      ? { oauthStore: 'memory', persistentOAuth: false }
      : { oauthStore: 'file', persistentOAuth: true });
}

export function resetDiagramMcpOAuthStoreForTests() {
  delete globalThis[STORE_KEY];
  delete globalThis[STORE_OVERRIDE_KEY];
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
