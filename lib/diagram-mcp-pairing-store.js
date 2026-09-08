import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const STORE_KEY = Symbol.for('anchor-read.diagram-mcp-pairing-store');
const STORE_OVERRIDE_KEY = Symbol.for('anchor-read.diagram-mcp-pairing-store-override');

const DEFAULT_CONNECTION_TTL_MS = 45_000;
const MAX_CONNECTIONS = 256;
const MAX_TOKENS = 512;
const MAX_WORKSPACES = 512;
const MAX_BINDINGS_PER_WORKSPACE = 64;
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
    bindingId: connection.bindingId,
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
    clientId: token.clientId || null,
    prefix: token.prefix,
    bindingId: token.bindingId || null,
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
    for (const [workspaceId, workspace] of this.workspaces) {
      const bindings = workspace?.bindings && typeof workspace.bindings === 'object'
        ? { ...workspace.bindings }
        : {};
      const bindingIdsInUse = new Set([
        ...[...this.connections.values()]
          .filter((connection) => connection.workspaceId === workspaceId)
          .map((connection) => connection.bindingId),
        ...[...this.tokens.values()]
          .filter((token) => token.workspaceId === workspaceId)
          .map((token) => token.bindingId),
      ].filter(Boolean));
      const ordered = Object.entries(bindings)
        .sort((left, right) => Number(left[1]?.lastSeenAt || left[1]?.createdAt || 0) - Number(right[1]?.lastSeenAt || right[1]?.createdAt || 0));
      let changed = false;
      while (ordered.length > MAX_BINDINGS_PER_WORKSPACE) {
        const removableIndex = ordered.findIndex(([, binding]) => !bindingIdsInUse.has(binding?.bindingId));
        if (removableIndex < 0) break;
        const [[browserSessionId]] = ordered.splice(removableIndex, 1);
        delete bindings[browserSessionId];
        changed = true;
      }
      if (changed) this.workspaces.set(workspaceId, { ...workspace, bindings });
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

  connectionForBinding(workspaceId, bindingId) {
    return [...this.connections.values()].find((connection) => (
      connection.workspaceId === workspaceId && connection.bindingId === bindingId
    )) || null;
  }

  authorizedBinding(context) {
    const workspaceId = identifier(context?.workspaceId, 'workspaceId');
    const rawBindingId = String(context?.bindingId || '').trim();
    if (!rawBindingId) {
      throw storeError(
        'BROWSER_BINDING_UPGRADE_REQUIRED',
        'This MCP authorization predates strict browser binding. Complete browser authorization again.',
      );
    }
    const bindingId = identifier(rawBindingId, 'bindingId');
    const browserSessionId = identifier(context?.browserSessionId, 'browserSessionId');
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw storeError('PAIRING_FORBIDDEN', 'The browser workspace is not paired yet.');
    const recorded = workspace.bindings?.[browserSessionId];
    if (!recorded || recorded.bindingId !== bindingId) {
      throw storeError(
        'BROWSER_BINDING_MISMATCH',
        'The MCP authorization does not match this browser connection. Complete browser authorization again.',
      );
    }
    return { workspace, workspaceId, browserSessionId, bindingId };
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
    const key = connectionKey(workspaceId, browserSessionId);
    const existing = this.connections.get(key);
    const active = this.activeConnection(workspaceId, now);
    if (active && active.clientId !== clientId && !replace) {
      throw storeError('CONNECTION_REPLACED', 'Another browser tab currently owns this workspace connection.');
    }
    const bindings = workspace?.bindings && typeof workspace.bindings === 'object'
      ? { ...workspace.bindings }
      : {};
    const existingBinding = bindings[browserSessionId];
    const bindingId = existingBinding?.bindingId || randomId('binding');
    bindings[browserSessionId] = {
      bindingId,
      browserSessionId,
      createdAt: existingBinding?.createdAt || now,
      lastSeenAt: now,
    };
    this.workspaces.set(workspaceId, {
      workspaceId,
      managementHash,
      createdAt: workspace?.createdAt || now,
      updatedAt: now,
      bindings,
    });

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
      bindingId,
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
    this.prune(now);
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

  getBindingInfo(context, { now = Date.now() } = {}) {
    this.prune(now);
    const workspaceId = identifier(context?.workspaceId, 'workspaceId');
    const browserSessionId = identifier(context?.browserSessionId, 'browserSessionId');
    const { workspace } = this.authorizeWorkspace(context);
    const bindingId = String(workspace.bindings?.[browserSessionId]?.bindingId || '').trim();
    if (!bindingId) {
      throw storeError(
        'BROWSER_BINDING_MISMATCH',
        'This browser session is not paired with a server-issued binding. Complete browser authorization again.',
      );
    }
    const connection = this.connectionForBinding(workspaceId, bindingId);
    return {
      workspaceId,
      browserSessionId,
      bindingId,
      connection: connection ? publicConnection(connection, now, context?.clientId) : null,
    };
  }

  async listTokensForBinding(context, { now = Date.now() } = {}) {
    const binding = this.getBindingInfo(context, { now });
    return {
      ...binding,
      tokens: [...this.tokens.values()]
        .filter((token) => (
          token.workspaceId === binding.workspaceId
          && token.browserSessionId === binding.browserSessionId
          && token.bindingId === binding.bindingId
        ))
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
        .map((token) => publicToken(token, now)),
    };
  }

  async revokeTokensForBinding(context, { clientId = '', tokenId = '', now = Date.now() } = {}) {
    this.prune(now);
    const binding = this.getBindingInfo(context, { now });
    const normalizedClientId = String(clientId || '').trim();
    const normalizedTokenId = String(tokenId || '').trim();
    const revoked = [];
    for (const token of this.tokens.values()) {
      if (token.workspaceId !== binding.workspaceId
        || token.browserSessionId !== binding.browserSessionId
        || token.bindingId !== binding.bindingId
        || (normalizedClientId && token.clientId !== normalizedClientId)
        || (normalizedTokenId && token.id !== normalizedTokenId)
        || token.revokedAt) continue;
      token.revokedAt = now;
      this.tokens.set(token.id, token);
      revoked.push(publicToken(token, now));
    }
    if (normalizedTokenId && revoked.length === 0) {
      throw storeError('TOKEN_NOT_FOUND', 'The requested MCP authorization was not found for this browser binding.');
    }
    return { ...binding, tokens: revoked };
  }

  // OAuth authorization codes are approved by the connected browser. Access
  // tokens are always short-lived and are never exposed in the browser UI.
  async createTokenForWorkspace(context, { name = 'MCP client', clientId = '', expiresInMs = 60 * 60 * 1000, now = Date.now() } = {}) {
    this.prune(now);
    const { workspaceId, browserSessionId, bindingId } = this.authorizedBinding(context);
    const connection = this.connectionForBinding(workspaceId, bindingId);
    const active = this.activeConnection(workspaceId, now);
    if (active && active.bindingId !== bindingId) {
      throw storeError(
        'BROWSER_BINDING_MISMATCH',
        'Another browser connection replaced the one that approved this MCP client. Complete browser authorization again.',
      );
    }
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
      clientId: String(clientId || '').trim().slice(0, 180) || null,
      workspaceId,
      browserSessionId,
      bindingId,
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
    if (!token.bindingId || !token.browserSessionId) {
      throw storeError(
        'BROWSER_BINDING_UPGRADE_REQUIRED',
        'This MCP authorization predates strict browser binding. Complete browser authorization again.',
      );
    }
    const active = this.activeConnection(token.workspaceId, now);
    if (active && active.bindingId !== token.bindingId) {
      throw storeError(
        'BROWSER_BINDING_MISMATCH',
        'This MCP authorization belongs to a different browser connection. Complete browser authorization again.',
      );
    }
    const connection = this.connectionForBinding(token.workspaceId, token.bindingId);
    token.lastUsedAt = now;
    const publicBinding = connection
      ? publicConnection(connection, now)
      : {
          bindingId: token.bindingId,
          workspaceId: token.workspaceId,
          browserSessionId: token.browserSessionId,
          tabId: '',
          clientId: '',
          connected: false,
          currentClient: false,
          status: 'disconnected',
        };
    return {
      token: publicToken(token, now),
      binding: publicBinding,
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
    this.loadedFileMtimeMs = -1;
    this.ready = this.load();
  }

  async load() {
    let raw;
    try {
      const metadata = await stat(this.filePath);
      raw = await readFile(this.filePath, 'utf8');
      this.loadedFileMtimeMs = metadata.mtimeMs;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.workspaces = new Map();
        this.tokens = new Map();
        this.tokenHashes = new Map();
        this.loadedFileMtimeMs = 0;
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

  async refreshIfChanged() {
    let currentMtimeMs = 0;
    try {
      currentMtimeMs = (await stat(this.filePath)).mtimeMs;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw storeError('PAIRING_STORE_UNAVAILABLE', `Cannot inspect the MCP pairing store at ${this.filePath}.`, error);
    }
    if (currentMtimeMs !== this.loadedFileMtimeMs) await this.load();
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
      this.loadedFileMtimeMs = (await stat(this.filePath)).mtimeMs;
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
      const workspaceId = String(context?.workspaceId || '').trim();
      const browserSessionId = String(context?.browserSessionId || '').trim();
      const knownWorkspace = this.workspaces.get(workspaceId);
      const knownBindings = JSON.stringify(knownWorkspace?.bindings || {});
      const connection = await super.registerConnection(context, options);
      persistWorkspace = !knownWorkspace
        || knownBindings !== JSON.stringify(this.workspaces.get(workspaceId)?.bindings || {});
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
    // The store is explicitly single-process, so reloading unchanged JSON and
    // queueing every read only adds latency to the MCP hot path. Refresh only
    // when another route context actually changed the file.
    return this.ready.then(async () => {
      await this.refreshIfChanged();
      return super.authenticateToken(secret, options);
    });
  }

  async getConnectionStatus(context, options) {
    await this.settle();
    return super.getConnectionStatus(context, options);
  }

  async assertConnectionOwner(context, options) {
    await this.settle();
    return super.assertConnectionOwner(context, options);
  }

  async listTokensForBinding(context, options) {
    await this.settle();
    return super.listTokensForBinding(context, options);
  }

  revokeTokensForBinding(context, options) {
    return this.runMutation(() => super.revokeTokensForBinding(context, options));
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
