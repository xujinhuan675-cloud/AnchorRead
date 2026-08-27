import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const STORE_KEY = Symbol.for('anchor-read.diagram-mcp-pairing-store');
const STORE_OVERRIDE_KEY = Symbol.for('anchor-read.diagram-mcp-pairing-store-override');

const DEFAULT_CONNECTION_TTL_MS = 45_000;
const MAX_CONNECTIONS = 256;
const MAX_TOKENS = 512;
const MAX_WORKSPACES = 512;
const STORE_VERSION = 1;

function randomId(prefix, bytes = 18) {
  return `${prefix}-${randomBytes(bytes).toString('base64url')}`;
}

function digest(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeDigestEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return a.length > 0 && timingSafeEqual(a, b);
}

function identifier(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 180 || !/^[A-Za-z0-9._:-]+$/u.test(normalized)) {
    const error = new Error(`Invalid ${name}.`);
    error.code = 'INVALID_PAIRING_CONTEXT';
    throw error;
  }
  return normalized;
}

function connectionKey(workspaceId, browserSessionId) {
  return `${workspaceId}:${browserSessionId}`;
}

function publicConnection(connection, now = Date.now(), clientId = '') {
  if (!connection) return null;
  const currentClient = String(clientId || '').trim();
  const connected = connection.expiresAt > now;
  return {
    workspaceId: connection.workspaceId,
    browserSessionId: connection.browserSessionId,
    tabId: connection.tabId,
    clientId: connection.clientId,
    href: connection.href,
    connected,
    currentClient: !currentClient || connection.clientId === currentClient,
    status: !connected
      ? 'disconnected'
      : (currentClient && connection.clientId !== currentClient ? 'replaced' : 'connected'),
    connectedAt: connection.connectedAt,
    lastSeenAt: connection.lastSeenAt,
    expiresAt: connection.expiresAt,
    generation: connection.generation,
  };
}

function publicToken(token, now = Date.now()) {
  const expired = Boolean(token.expiresAt && token.expiresAt <= now);
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt || null,
    expiresAt: token.expiresAt || null,
    revokedAt: token.revokedAt || null,
    status: token.revokedAt ? 'revoked' : (expired ? 'expired' : 'active'),
  };
}

function storeError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function defaultStorePath() {
  const configured = String(process.env.ANCHORREAD_MCP_PAIRING_STORE_PATH || '').trim();
  return resolve(configured || join(process.cwd(), '.anchorread-data', 'diagram-mcp-pairings.json'));
}

function isMemoryStoreConfigured() {
  return String(process.env.ANCHORREAD_MCP_PAIRING_STORE || '').trim().toLowerCase() === 'memory';
}

export class InMemoryDiagramMcpPairingStore {
  constructor({
    connectionTtlMs = DEFAULT_CONNECTION_TTL_MS,
    maxConnections = MAX_CONNECTIONS,
    maxTokens = MAX_TOKENS,
  } = {}) {
    this.runtimeInfo = {
      pairingStore: 'memory',
      requestBroker: 'memory',
      transport: 'long-poll',
      multiInstance: false,
      persistentTokens: false,
    };
    this.connectionTtlMs = connectionTtlMs;
    this.maxConnections = maxConnections;
    this.maxTokens = maxTokens;
    this.connections = new Map();
    this.workspaces = new Map();
    this.tokens = new Map();
    this.tokenHashes = new Map();
  }

  prune(now = Date.now()) {
    for (const [key, connection] of this.connections) {
      if (connection.expiresAt + 60_000 <= now) this.connections.delete(key);
    }
    while (this.connections.size > this.maxConnections) {
      this.connections.delete(this.connections.keys().next().value);
    }
    for (const [id, token] of this.tokens) {
      if (token.expiresAt && token.expiresAt <= now) {
        this.tokens.delete(id);
        this.tokenHashes.delete(token.tokenHash);
      }
    }
    while (this.tokens.size > this.maxTokens) {
      const removable = [...this.tokens.values()].find((token) => token.revokedAt);
      if (!removable) break;
      this.tokens.delete(removable.id);
      this.tokenHashes.delete(removable.tokenHash);
    }
    while (this.workspaces.size > MAX_WORKSPACES) {
      const removable = [...this.workspaces.values()].find((workspace) => (
        ![...this.tokens.values()].some((token) => token.workspaceId === workspace.workspaceId)
        && ![...this.connections.values()].some((connection) => connection.workspaceId === workspace.workspaceId)
      ));
      if (!removable) break;
      this.workspaces.delete(removable.workspaceId);
    }
  }

  authorizeWorkspace(context) {
    const workspaceId = identifier(context?.workspaceId, 'workspaceId');
    const managementSecret = identifier(context?.managementSecret, 'managementSecret');
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace || !safeDigestEqual(workspace.managementHash, digest(managementSecret))) {
      throw storeError('PAIRING_FORBIDDEN', 'The browser pairing secret does not match this workspace.');
    }
    return { workspace, workspaceId };
  }

  managedConnection(context, now = Date.now()) {
    const { workspace, workspaceId } = this.authorizeWorkspace(context);
    const browserSessionId = identifier(context?.browserSessionId, 'browserSessionId');
    const connection = this.connections.get(connectionKey(workspaceId, browserSessionId));
    if (!connection) {
      throw storeError('BROWSER_SESSION_OFFLINE', 'This browser session is not registered for the workspace.');
    }
    return { connection, workspace, workspaceId, browserSessionId, now };
  }

  activeConnection(workspaceId, now = Date.now()) {
    return [...this.connections.values()]
      .filter((connection) => connection.workspaceId === workspaceId && connection.expiresAt > now)
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)[0] || null;
  }

  async registerConnection(context, { replace = false, now = Date.now() } = {}) {
    this.prune(now);
    const workspaceId = identifier(context?.workspaceId, 'workspaceId');
    const browserSessionId = identifier(context?.browserSessionId, 'browserSessionId');
    const tabId = identifier(context?.tabId, 'tabId');
    const clientId = identifier(context?.clientId, 'clientId');
    const managementSecret = identifier(context?.managementSecret, 'managementSecret');
    const managementHash = digest(managementSecret);
    const workspace = this.workspaces.get(workspaceId);
    if (workspace && !safeDigestEqual(workspace.managementHash, managementHash)) {
      throw storeError('PAIRING_FORBIDDEN', 'The browser pairing secret does not match this workspace.');
    }
    this.workspaces.set(workspaceId, {
      workspaceId,
      managementHash,
      createdAt: workspace?.createdAt || now,
      updatedAt: workspace?.updatedAt || now,
    });

    const key = connectionKey(workspaceId, browserSessionId);
    const existing = this.connections.get(key);
    const active = this.activeConnection(workspaceId, now);
    if (active && active.clientId !== clientId && !replace) {
      throw storeError('CONNECTION_REPLACED', 'Another browser tab currently owns this workspace connection.');
    }
    if (replace) {
      for (const [otherKey, connection] of this.connections) {
        if (connection.workspaceId === workspaceId && connection.clientId !== clientId && connection.expiresAt > now) {
          connection.expiresAt = now;
          connection.lastSeenAt = now;
          this.connections.set(otherKey, connection);
        }
      }
    }

    const connection = {
      workspaceId,
      browserSessionId,
      tabId,
      clientId,
      href: String(context?.href || '').slice(0, 500),
      connectedAt: existing?.connectedAt || now,
      lastSeenAt: now,
      expiresAt: now + Math.max(5_000, Number(this.connectionTtlMs) || DEFAULT_CONNECTION_TTL_MS),
      generation: (existing?.generation || 0) + (existing?.clientId === clientId ? 0 : 1),
    };
    this.connections.delete(key);
    this.connections.set(key, connection);
    return publicConnection(connection, now, clientId);
  }

  async disconnectConnection(context, { now = Date.now() } = {}) {
    const { connection, workspaceId, browserSessionId } = this.managedConnection(context, now);
    if (connection.clientId !== String(context?.clientId || '').trim()) return false;
    connection.expiresAt = now;
    connection.lastSeenAt = now;
    this.connections.set(connectionKey(workspaceId, browserSessionId), connection);
    return true;
  }

  async getConnectionStatus(context, { now = Date.now() } = {}) {
    const { connection } = this.managedConnection(context, now);
    return publicConnection(connection, now, context?.clientId);
  }

  async assertConnectionOwner(context, { now = Date.now(), requireConnected = true } = {}) {
    const status = await this.getConnectionStatus(context, { now });
    if (!status.currentClient) throw storeError('CONNECTION_REPLACED', 'This browser tab no longer owns the paired workspace.');
    if (requireConnected && !status.connected) throw storeError('BROWSER_SESSION_OFFLINE', 'The paired browser workspace is offline.');
    return status;
  }

  // OAuth authorization codes are approved by the connected browser. Access
  // tokens are always short-lived and are never exposed in the browser UI.
  async createTokenForWorkspace(context, { name = 'MCP client', expiresInMs = 60 * 60 * 1000, now = Date.now() } = {}) {
    const workspaceId = identifier(context?.workspaceId, 'workspaceId');
    if (!this.workspaces.has(workspaceId)) {
      throw storeError('PAIRING_FORBIDDEN', 'The browser workspace is not paired yet.');
    }
    const connection = this.activeConnection(workspaceId, now);
    this.prune(now);
    const activeCount = [...this.tokens.values()].filter((token) => !token.revokedAt).length;
    if (activeCount >= this.maxTokens) {
      throw storeError('TOKEN_LIMIT_REACHED', 'The remote MCP token limit has been reached. Revoke an existing token first.');
    }
    const id = randomId('token', 9);
    const secret = `armcp_${randomBytes(32).toString('base64url')}`;
    const numericExpiry = Number(expiresInMs);
    const token = {
      id,
      tokenHash: digest(secret),
      prefix: `${secret.slice(0, 12)}...${secret.slice(-4)}`,
      name: String(name || 'MCP client').trim().slice(0, 80) || 'MCP client',
      workspaceId,
      createdAt: now,
      revokedAt: null,
      lastUsedAt: null,
      expiresAt: Number.isFinite(numericExpiry) && numericExpiry > 0 ? now + numericExpiry : null,
    };
    this.tokens.set(token.id, token);
    this.tokenHashes.set(token.tokenHash, token.id);
    this.prune(now);
    return {
      token: secret,
      record: publicToken(token, now),
      binding: connection ? publicConnection(connection, now) : null,
    };
  }

  async authenticateToken(secret, { now = Date.now() } = {}) {
    const tokenId = this.tokenHashes.get(digest(secret));
    const token = tokenId ? this.tokens.get(tokenId) : null;
    if (!token) throw storeError('TOKEN_UNKNOWN', 'Remote MCP token is invalid.');
    if (token.revokedAt) throw storeError('TOKEN_REVOKED', 'Remote MCP token has been revoked.');
    if (token.expiresAt && token.expiresAt <= now) throw storeError('TOKEN_EXPIRED', 'Remote MCP token has expired.');
    token.lastUsedAt = now;
    const connection = this.activeConnection(token.workspaceId, now);
    return {
      token: publicToken(token, now),
      binding: {
        workspaceId: token.workspaceId,
        browserSessionId: connection?.browserSessionId || '',
        tabId: connection?.tabId || '',
        clientId: connection?.clientId || '',
        connected: Boolean(connection),
      },
    };
  }

  async snapshot(context, { now = Date.now() } = {}) {
    return {
      connection: await this.getConnectionStatus(context, { now }),
      runtime: this.runtimeInfo,
    };
  }
}

export class FileDiagramMcpPairingStore extends InMemoryDiagramMcpPairingStore {
  constructor({ filePath = defaultStorePath(), ...options } = {}) {
    super(options);
    this.filePath = resolve(filePath);
    this.runtimeInfo = {
      pairingStore: 'file',
      requestBroker: 'memory',
      transport: 'long-poll',
      multiInstance: false,
      persistentTokens: true,
      warning: 'Tokens persist across restarts, but browser presence, MCP sessions, and request routing still require one Node process.',
    };
    this.operationTail = Promise.resolve();
    this.ready = this.load();
  }

  async load() {
    let raw;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.workspaces = new Map();
        this.tokens = new Map();
        this.tokenHashes = new Map();
        return;
      }
      throw storeError('PAIRING_STORE_UNAVAILABLE', `Cannot read the MCP pairing store at ${this.filePath}.`, error);
    }
    try {
      const data = JSON.parse(raw);
      if (data?.version !== STORE_VERSION) throw new Error(`Unsupported store version: ${data?.version}`);
      const workspaces = new Map();
      const tokens = new Map();
      const tokenHashes = new Map();
      for (const workspace of data.workspaces || []) {
        if (!workspace?.workspaceId || !workspace?.managementHash) continue;
        workspaces.set(workspace.workspaceId, { ...workspace });
      }
      for (const token of data.tokens || []) {
        // Non-expiring records came from the removed manual static-token flow.
        if (!token?.id || !token?.workspaceId || !token?.tokenHash || !Number.isFinite(Number(token.expiresAt)) || Number(token.expiresAt) <= 0 || !workspaces.has(token.workspaceId)) continue;
        tokens.set(token.id, { ...token });
        tokenHashes.set(token.tokenHash, token.id);
      }
      this.workspaces = workspaces;
      this.tokens = tokens;
      this.tokenHashes = tokenHashes;
    } catch (error) {
      throw storeError('PAIRING_STORE_UNAVAILABLE', `The MCP pairing store at ${this.filePath} is invalid.`, error);
    }
  }

  async persist() {
    const payload = JSON.stringify({
      version: STORE_VERSION,
      workspaces: [...this.workspaces.values()],
      tokens: [...this.tokens.values()],
    }, null, 2);
    const temporaryPath = `${this.filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw storeError('PAIRING_STORE_UNAVAILABLE', `Cannot persist the MCP pairing store at ${this.filePath}.`, error);
    }
  }

  runMutation(operation, { persist = true } = {}) {
    const run = this.operationTail.then(async () => {
      await this.ready;
      await this.load();
      const transactional = persist !== false;
      const before = transactional ? {
        connections: new Map([...this.connections].map(([key, value]) => [key, { ...value }])),
        workspaces: new Map([...this.workspaces].map(([key, value]) => [key, { ...value }])),
        tokens: new Map([...this.tokens].map(([key, value]) => [key, { ...value }])),
        tokenHashes: new Map(this.tokenHashes),
      } : null;
      try {
        const result = await operation();
        if (typeof persist === 'function' ? persist() : persist) await this.persist();
        return result;
      } catch (error) {
        if (before) {
          this.connections = before.connections;
          this.workspaces = before.workspaces;
          this.tokens = before.tokens;
          this.tokenHashes = before.tokenHashes;
        }
        throw error;
      }
    });
    this.operationTail = run.catch(() => {});
    return run;
  }

  async settle() {
    await this.ready;
    await this.operationTail;
  }

  registerConnection(context, options) {
    let persistWorkspace = false;
    return this.runMutation(async () => {
      const knownWorkspace = this.workspaces.has(String(context?.workspaceId || '').trim());
      const connection = await super.registerConnection(context, options);
      persistWorkspace = !knownWorkspace;
      return connection;
    }, { persist: () => persistWorkspace });
  }

  disconnectConnection(context, options) {
    return this.runMutation(() => super.disconnectConnection(context, options), { persist: false });
  }

  createTokenForWorkspace(context, options) {
    return this.runMutation(() => super.createTokenForWorkspace(context, options));
  }

  authenticateToken(secret, options) {
    // Usage telemetry is intentionally process-local; token validity and
    // revocation remain durable without a disk write per MCP request.
    return this.runMutation(() => super.authenticateToken(secret, options), { persist: false });
  }

  async getConnectionStatus(context, options) {
    await this.settle();
    return super.getConnectionStatus(context, options);
  }

  async assertConnectionOwner(context, options) {
    await this.settle();
    return super.assertConnectionOwner(context, options);
  }

  async snapshot(context, options) {
    await this.settle();
    return {
      connection: await InMemoryDiagramMcpPairingStore.prototype.getConnectionStatus.call(this, context, options),
      runtime: this.runtimeInfo,
    };
  }
}

export function getDiagramMcpPairingStore() {
  if (globalThis[STORE_OVERRIDE_KEY]) return globalThis[STORE_OVERRIDE_KEY];
  if (!globalThis[STORE_KEY]) {
    globalThis[STORE_KEY] = isMemoryStoreConfigured()
      ? new InMemoryDiagramMcpPairingStore()
      : new FileDiagramMcpPairingStore();
  }
  return globalThis[STORE_KEY];
}

export function setDiagramMcpPairingStore(store) {
  globalThis[STORE_OVERRIDE_KEY] = store || null;
}

export function resetDiagramMcpPairingStoreForTests() {
  delete globalThis[STORE_KEY];
  delete globalThis[STORE_OVERRIDE_KEY];
}

export function getDiagramMcpRuntimeInfo() {
  const configured = globalThis[STORE_OVERRIDE_KEY]?.runtimeInfo || globalThis[STORE_KEY]?.runtimeInfo || (isMemoryStoreConfigured()
    ? { pairingStore: 'memory', persistentTokens: false }
    : { pairingStore: 'file', persistentTokens: true });
  const multiInstance = configured.multiInstance === true;
  return {
    pairingStore: configured.pairingStore || 'memory',
    requestBroker: configured.requestBroker || 'memory',
    transport: configured.transport || 'long-poll',
    multiInstance,
    persistentTokens: configured.persistentTokens === true,
    warning: configured.warning || (multiInstance
      ? ''
      : (configured.persistentTokens
        ? 'OAuth access tokens persist across restarts, but browser presence, MCP sessions, and requests still require one Node process.'
        : 'Browser bindings, OAuth access tokens, MCP sessions, and requests live in one Node process. A restart invalidates tokens; multiple replicas are not supported.')),
  };
}

export const DIAGRAM_MCP_CONNECTION_TTL_MS = DEFAULT_CONNECTION_TTL_MS;
