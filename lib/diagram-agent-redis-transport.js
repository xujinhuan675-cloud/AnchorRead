import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { createClient } from 'redis';
import { diagramAgentBuildCompatibility, serializeDiagramAgentError } from './diagram-agent-protocol.js';

const DEFAULT_PREFIX = 'anchorread:diagram-agent';
const DEFAULT_TTL_MS = 60_000;
const CLIENT_TTL_MS = 12_000;
const RESULT_TTL_MS = 60_000;
const MAX_PENDING = 32;
const LOCK_TTL_MS = 5_000;
const LOCK_WAIT_MS = 1_500;
const POLL_INTERVAL_MS = 200;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalized(value) {
  return String(value || '').trim();
}

function safeSegment(value, fallback) {
  const clean = normalized(value).replace(/[^A-Za-z0-9._:-]/gu, '-').slice(0, 120);
  return clean || fallback;
}

function opaqueId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function shardForWorkspace(workspaceId) {
  const workspace = normalized(workspaceId);
  return workspace
    ? `workspace-${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 24)}`
    : 'unscoped';
}

function shardForScope(workspaceId, bindingId = '') {
  const workspace = normalized(workspaceId);
  const binding = normalized(bindingId);
  if (!workspace) return 'unscoped';
  if (!binding) return shardForWorkspace(workspace);
  return `binding-${createHash('sha256').update(`${workspace}\0${binding}`, 'utf8').digest('hex').slice(0, 24)}`;
}

function publicClient(client) {
  if (!client) return null;
  return {
    clientId: client.clientId,
    tabId: client.tabId,
    workspaceId: client.workspaceId,
    bindingId: client.bindingId,
    browserSessionId: client.browserSessionId,
    visible: client.visible,
    focused: client.focused,
    href: client.href,
    buildSha: client.buildSha,
    buildVersion: client.buildVersion,
    protocolVersion: client.protocolVersion,
    seenAt: client.seenAt,
    seenSequence: client.seenSequence,
    expiresAt: client.expiresAt,
  };
}

function normalizedClient(clientId, client = {}, now = Date.now(), sequence = 0) {
  const normalizedClientId = normalized(clientId);
  if (!normalizedClientId) return null;
  return {
    clientId: normalizedClientId,
    tabId: normalized(client.tabId || normalizedClientId),
    workspaceId: normalized(client.workspaceId),
    bindingId: normalized(client.bindingId),
    browserSessionId: normalized(client.browserSessionId),
    visible: client.visible !== false,
    focused: client.focused !== false,
    href: normalized(client.href).slice(0, 500),
    buildSha: normalized(client.buildSha),
    buildVersion: normalized(client.buildVersion),
    protocolVersion: normalized(client.protocolVersion),
    seenAt: now,
    seenSequence: sequence,
    expiresAt: now + CLIENT_TTL_MS,
  };
}

function requestTargetsClient(request, client) {
  const target = request.scope || {};
  if (normalized(target.clientId) && target.clientId !== client.clientId) return false;
  if (normalized(target.tabId) && target.tabId !== client.tabId) return false;
  if (normalized(target.workspaceId) && target.workspaceId !== client.workspaceId) return false;
  if (normalized(target.bindingId) && target.bindingId !== client.bindingId) return false;
  if (normalized(target.browserSessionId) && target.browserSessionId !== client.browserSessionId) return false;
  return true;
}

function selectActiveClient(clients, request) {
  const matching = clients.filter((client) => (
    client.visible
    && diagramAgentBuildCompatibility(client).compatible
    && requestTargetsClient(request, client)
  ));
  return matching.sort((left, right) => (
    Number(right.focused) - Number(left.focused)
    || right.seenAt - left.seenAt
    || right.seenSequence - left.seenSequence
  ))[0] || null;
}

function errorRecord(error, fallbackCode = 'BRIDGE_ERROR') {
  const serialized = serializeDiagramAgentError(error);
  return { ...serialized, code: normalized(error?.code) || fallbackCode };
}

function responseError(record) {
  const error = new Error(String(record?.message || 'Diagram bridge request failed.'));
  Object.assign(error, record, { code: normalized(record?.code) || 'BRIDGE_ERROR' });
  error.diagramBrokerResponse = true;
  return error;
}

function brokerError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function brokerFailure(error) {
  if (['BRIDGE_QUEUE_FULL', 'BROKER_BUSY', 'BROKER_CONFIG_ERROR', 'BROKER_UNAVAILABLE'].includes(normalized(error?.code))) {
    return error;
  }
  return brokerError('BROKER_UNAVAILABLE', 'The Redis diagram request broker is unavailable.', error);
}

function defaultInstanceId() {
  const configured = normalized(process.env.ANCHORREAD_INSTANCE_ID);
  if (configured) return safeSegment(configured, 'anchorread-instance');
  return safeSegment(`${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`, 'anchorread-instance');
}

function defaultLogger(event) {
  console.info('[diagram-broker]', event);
}

export class RedisDiagramAgentTransport {
  constructor({
    url = process.env.ANCHORREAD_REDIS_URL,
    prefix = process.env.ANCHORREAD_DIAGRAM_REDIS_PREFIX || DEFAULT_PREFIX,
    instanceId = defaultInstanceId(),
    client = null,
    logger = defaultLogger,
    now = () => Date.now(),
  } = {}) {
    this.url = normalized(url);
    this.prefix = safeSegment(prefix, DEFAULT_PREFIX);
    this.instanceId = safeSegment(instanceId, 'anchorread-instance');
    this.injectedClient = client;
    this.clientPromise = null;
    this.logger = typeof logger === 'function' ? logger : () => {};
    this.now = now;
    this.requestShards = new Map();
    this.runtimeInfo = Object.freeze({
      requestBroker: 'redis',
      transport: 'redis-long-poll',
      multiInstance: false,
      sharedRequestBroker: true,
      requestRoutingMultiInstance: true,
      mcpSessionAffinityRequired: true,
      instanceId: this.instanceId,
      warning: 'Diagram request routing is shared through Redis; MCP sessions and file-backed OAuth/pairing metadata still require session affinity.',
    });
  }

  keys(shard) {
    const tag = `{${safeSegment(shard, 'unscoped')}}`;
    const base = `${this.prefix}:${tag}`;
    return {
      lock: `${base}:lock`,
      pending: `${base}:pending`,
      expiries: `${base}:expiries`,
      clients: `${base}:clients`,
      clientSequence: `${base}:client-sequence`,
      request: (id) => `${base}:request:${id}`,
      response: (id) => `${base}:response:${id}`,
      client: (id) => `${base}:client:${safeSegment(id, 'unknown')}`,
    };
  }

  requestIndexKey(requestId) {
    return `${this.prefix}:request-index:${safeSegment(requestId, 'unknown')}`;
  }

  clientIndexKey(clientId) {
    return `${this.prefix}:client-index:${safeSegment(clientId, 'unknown')}`;
  }

  async addClientIndex(redis, clientId, shard) {
    const key = this.clientIndexKey(clientId);
    let shards = [];
    const raw = await redis.get(key);
    if (raw) {
      try {
        shards = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [raw];
      } catch {
        shards = [raw];
      }
    }
    if (!shards.includes(shard)) shards.push(shard);
    await redis.set(key, JSON.stringify(shards), { PX: CLIENT_TTL_MS });
  }

  tokenRequestsKey(tokenId) {
    return `${this.prefix}:token:${safeSegment(tokenId, 'unknown')}:requests`;
  }

  log(event, fields = {}) {
    this.logger({ event, instance_id: this.instanceId, broker: 'redis', ...fields });
  }

  async redis() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        if (this.injectedClient) {
          if (this.injectedClient.connect && this.injectedClient.isOpen === false) {
            await this.injectedClient.connect();
          }
          return this.injectedClient;
        }
        if (!this.url) {
          throw brokerError('BROKER_CONFIG_ERROR', 'ANCHORREAD_REDIS_URL is required when ANCHORREAD_DIAGRAM_BROKER=redis.');
        }
        const client = createClient({
          url: this.url,
          disableOfflineQueue: true,
          socket: {
            connectTimeout: 5_000,
            reconnectStrategy: (retries) => Math.min(100 + (retries * 100), 2_000),
          },
        });
        client.on('error', (error) => this.log('redis_error', { error_code: normalized(error?.code) || 'REDIS_ERROR' }));
        await client.connect();
        this.log('redis_ready');
        return client;
      })().catch((error) => {
        this.clientPromise = null;
        throw brokerFailure(error);
      });
    }
    return this.clientPromise;
  }

  async assertReady() {
    await this.redis();
    return true;
  }

  async withShardLock(shard, operation) {
    try {
      const redis = await this.redis();
      const { lock } = this.keys(shard);
      const token = opaqueId('lock');
      const deadline = this.now() + LOCK_WAIT_MS;
      while (this.now() <= deadline) {
        const acquired = await redis.set(lock, token, { NX: true, PX: LOCK_TTL_MS });
        if (acquired === 'OK') {
          try {
            return await operation(redis, this.keys(shard));
          } finally {
            await redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lock], arguments: [token] }).catch(() => {});
          }
        }
        await sleep(20 + Math.floor(Math.random() * 20));
      }
      throw brokerError('BROKER_BUSY', `The Redis diagram request shard ${shard} is busy.`);
    } catch (error) {
      const failure = brokerFailure(error);
      if (failure !== error) this.log('redis_operation_failed', { shard, error_code: normalized(error?.code) || 'REDIS_ERROR' });
      throw failure;
    }
  }

  async cleanup(redis, keys, now = this.now()) {
    const expired = await redis.zRangeByScore(keys.expiries, 0, now);
    for (const requestId of expired) {
      await redis.del(keys.request(requestId));
      await redis.zRem(keys.pending, requestId);
      await redis.zRem(keys.expiries, requestId);
    }
    const expiredClients = await redis.zRangeByScore(keys.clients, 0, now);
    for (const clientId of expiredClients) {
      await redis.del(keys.client(clientId));
      await redis.zRem(keys.clients, clientId);
    }
  }

  async activeClients(redis, keys, now = this.now()) {
    const clientIds = await redis.zRangeByScore(keys.clients, now + 1, '+inf');
    if (!clientIds.length) return [];
    const records = await redis.mGet(clientIds.map((clientId) => keys.client(clientId)));
    return records.flatMap((record) => {
      if (!record) return [];
      try {
        const client = JSON.parse(record);
        return client.expiresAt > now ? [client] : [];
      } catch {
        return [];
      }
    });
  }

  async registerClientInShard(clientId, client, shard) {
    return this.withShardLock(shard, async (redis, keys) => {
      const now = this.now();
      await this.cleanup(redis, keys, now);
      const sequence = Number(await redis.incr(keys.clientSequence));
      const record = normalizedClient(clientId, client, now, sequence);
      if (!record) return null;
      await redis.set(keys.client(record.clientId), JSON.stringify(record), { PX: CLIENT_TTL_MS });
      await redis.zAdd(keys.clients, [{ score: record.expiresAt, value: record.clientId }]);
      await this.addClientIndex(redis, record.clientId, shard);
      return publicClient(record);
    });
  }

  async registerClient(clientId, client = {}) {
    const workspaceShard = shardForWorkspace(client.workspaceId);
    const scopeShard = shardForScope(client.workspaceId, client.bindingId);
    const shards = new Set([scopeShard, workspaceShard, 'unscoped']);
    let record = null;
    for (const shard of shards) {
      const registered = await this.registerClientInShard(clientId, client, shard);
      if (registered) record = registered;
    }
    return record;
  }

  async unregisterClient(clientId, client = {}) {
    const redis = await this.redis();
    const indexKey = this.clientIndexKey(clientId);
    const indexed = await redis.get(indexKey).catch((error) => { throw brokerFailure(error); });
    let indexedShards = [];
    if (indexed) {
      try {
        indexedShards = Array.isArray(JSON.parse(indexed)) ? JSON.parse(indexed) : [indexed];
      } catch {
        indexedShards = [indexed];
      }
    }
    const shards = new Set(indexedShards);
    if (normalized(client.workspaceId)) {
      shards.add(shardForScope(client.workspaceId, client.bindingId));
      shards.add(shardForWorkspace(client.workspaceId));
      shards.add('unscoped');
    }
    if (!shards.size) return false;
    let removed = false;
    for (const targetShard of shards) {
      const targetRemoved = await this.withShardLock(targetShard, async (lockedRedis, keys) => {
        await lockedRedis.zRem(keys.clients, normalized(clientId));
        return (await lockedRedis.del(keys.client(clientId))) > 0;
      });
      removed = removed || targetRemoved;
    }
    await redis.del(this.clientIndexKey(clientId)).catch((error) => { throw brokerFailure(error); });
    return removed;
  }

  async createRequest(payload, {
    ttlMs = DEFAULT_TTL_MS,
    scope = null,
    tokenId = '',
  } = {}) {
    const now = this.now();
    const boundedTtl = Math.max(1_000, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, 5 * 60_000));
    const normalizedScope = scope ? {
      workspaceId: normalized(scope.workspaceId),
      bindingId: normalized(scope.bindingId),
      browserSessionId: normalized(scope.browserSessionId),
      tabId: normalized(scope.tabId),
      clientId: normalized(scope.clientId),
    } : null;
    const shard = shardForScope(normalizedScope?.workspaceId, normalizedScope?.bindingId);
    const requestId = opaqueId('diagram-agent');
    const request = {
      id: requestId,
      payload,
      scope: normalizedScope,
      tokenId: normalized(tokenId),
      status: 'pending',
      shard,
      createdAt: now,
      expiresAt: now + boundedTtl,
      createdByInstanceId: this.instanceId,
    };
    await this.withShardLock(shard, async (redis, keys) => {
      await this.cleanup(redis, keys, now);
      if (Number(await redis.zCard(keys.pending)) >= MAX_PENDING) {
        throw brokerError('BRIDGE_QUEUE_FULL', 'Too many pending diagram bridge requests in this workspace.');
      }
      await redis.multi()
        .set(keys.request(requestId), JSON.stringify(request), { PX: boundedTtl })
        .zAdd(keys.pending, [{ score: now, value: requestId }])
        .zAdd(keys.expiries, [{ score: request.expiresAt, value: requestId }])
        .exec();
      await redis.set(this.requestIndexKey(requestId), shard, { PX: boundedTtl + RESULT_TTL_MS });
      if (request.tokenId) {
        const tokenKey = this.tokenRequestsKey(request.tokenId);
        await redis.sAdd(tokenKey, `${shard}|${requestId}`);
        await redis.pExpire(tokenKey, boundedTtl + RESULT_TTL_MS);
      }
    });
    this.requestShards.set(requestId, shard);
    this.log('request_enqueued', {
      request_id: requestId,
      shard,
      created_instance_id: this.instanceId,
      expires_at: request.expiresAt,
    });
    return {
      id: requestId,
      promise: this.waitForResult(requestId, shard, request.expiresAt),
    };
  }

  async claimFromShard(clientId, client, shard, limit) {
    return this.withShardLock(shard, async (redis, keys) => {
      const now = this.now();
      await this.cleanup(redis, keys, now);
      const registeredRaw = await redis.get(keys.client(clientId));
      if (!registeredRaw) return [];
      const registered = JSON.parse(registeredRaw);
      if (!registered.visible || registered.expiresAt <= now) return [];
      const clients = await this.activeClients(redis, keys, now);
      const pendingIds = await redis.zRange(keys.pending, 0, MAX_PENDING - 1);
      const claimed = [];
      for (const requestId of pendingIds) {
        if (claimed.length >= limit) break;
        const raw = await redis.get(keys.request(requestId));
        if (!raw) {
          await redis.zRem(keys.pending, requestId);
          await redis.zRem(keys.expiries, requestId);
          continue;
        }
        const request = JSON.parse(raw);
        if (request.status !== 'pending' || !requestTargetsClient(request, registered)) continue;
        const active = selectActiveClient(clients, request);
        if (active?.clientId !== registered.clientId) continue;
        const claimToken = opaqueId('claim');
        const remainingTtl = await redis.pTTL(keys.request(requestId));
        if (remainingTtl <= 0) continue;
        request.status = 'claimed';
        request.clientId = registered.clientId;
        request.claimToken = claimToken;
        request.claimedAt = now;
        request.claimedByInstanceId = this.instanceId;
        request.claimedClient = {
          workspaceId: registered.workspaceId,
          bindingId: registered.bindingId,
          browserSessionId: registered.browserSessionId,
          tabId: registered.tabId,
          clientId: registered.clientId,
        };
        await redis.multi()
          .set(keys.request(requestId), JSON.stringify(request), { PX: remainingTtl })
          .zRem(keys.pending, requestId)
          .exec();
        claimed.push({
          id: request.id,
          payload: request.payload,
          createdAt: request.createdAt,
          expiresAt: request.expiresAt,
          claimToken,
        });
        this.log('request_claimed', {
          request_id: requestId,
          shard,
          created_instance_id: request.createdByInstanceId,
          claim_instance_id: this.instanceId,
          client_id: registered.clientId,
        });
      }
      return claimed;
    });
  }

  async claimRequests(clientId, { limit = 4, client = {} } = {}) {
    const registered = await this.registerClient(clientId, client);
    if (!registered?.visible) return [];
    const max = Math.max(1, Math.min(Number(limit) || 1, 8));
    const shards = new Set([
      shardForScope(registered.workspaceId, registered.bindingId),
      shardForWorkspace(registered.workspaceId),
      'unscoped',
    ]);
    const claimed = [];
    for (const shard of shards) {
      const batch = await this.claimFromShard(registered.clientId, registered, shard, max - claimed.length);
      claimed.push(...batch);
      if (claimed.length >= max) break;
    }
    return claimed;
  }

  async waitForRequests(clientId, { limit = 4, waitMs = 20_000, client = {} } = {}) {
    const deadline = this.now() + Math.max(0, Math.min(Number(waitMs) || 0, 25_000));
    let nextRegistrationAt = 0;
    do {
      if (this.now() >= nextRegistrationAt) {
        await this.registerClient(clientId, client);
        nextRegistrationAt = this.now() + Math.floor(CLIENT_TTL_MS / 3);
      }
      const max = Math.max(1, Math.min(Number(limit) || 1, 8));
      const shards = new Set([
        shardForScope(client.workspaceId, client.bindingId),
        shardForWorkspace(client.workspaceId),
        'unscoped',
      ]);
      let requests = [];
      for (const shard of shards) {
        requests = await this.claimFromShard(clientId, client, shard, max);
        if (requests.length) break;
      }
      if (requests.length || this.now() >= deadline) return requests;
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - this.now())));
    } while (true);
  }

  async writeResponse(redis, keys, request, response) {
    const responseWithRequest = { ...response, createdAt: request.createdAt };
    await redis.multi()
      .set(keys.response(request.id), JSON.stringify(responseWithRequest), { PX: RESULT_TTL_MS })
      .del(keys.request(request.id))
      .zRem(keys.pending, request.id)
      .zRem(keys.expiries, request.id)
      .exec();
    if (request.tokenId) await redis.sRem(this.tokenRequestsKey(request.tokenId), `${request.shard || shardForScope(request.scope?.workspaceId, request.scope?.bindingId)}|${request.id}`);
  }

  async resolveRequest(requestId, claimToken, result, error, { client = {} } = {}) {
    const redis = await this.redis();
    const shard = await redis.get(this.requestIndexKey(requestId)).catch((failure) => { throw brokerFailure(failure); })
      || (normalized(client.workspaceId) ? shardForScope(client.workspaceId, client.bindingId) : '');
    if (!shard) return false;
    const accepted = await this.withShardLock(shard, async (lockedRedis, keys) => {
      const raw = await lockedRedis.get(keys.request(requestId));
      if (!raw) return false;
      const request = JSON.parse(raw);
      if (request.status !== 'claimed' || request.claimToken !== claimToken) return false;
      const claimedClient = request.claimedClient || {};
      for (const field of ['workspaceId', 'bindingId', 'browserSessionId', 'tabId', 'clientId']) {
        if (normalized(claimedClient[field]) && normalized(client[field]) !== claimedClient[field]) return false;
      }
      const response = error
        ? { ok: false, error: errorRecord(error), resolvedAt: this.now(), resolvedByInstanceId: this.instanceId }
        : { ok: true, result, resolvedAt: this.now(), resolvedByInstanceId: this.instanceId };
      await this.writeResponse(lockedRedis, keys, request, response);
      this.log('request_resolved', {
        request_id: requestId,
        shard,
        created_instance_id: request.createdByInstanceId,
        claim_instance_id: request.claimedByInstanceId,
        resolve_instance_id: this.instanceId,
        outcome: error ? 'error' : 'ok',
      });
      return true;
    });
    return accepted;
  }

  async cancelRequest(requestId, error = brokerError('BRIDGE_TIMEOUT', 'Diagram bridge request timed out.')) {
    const redis = await this.redis();
    const shard = this.requestShards.get(requestId)
      || await redis.get(this.requestIndexKey(requestId)).catch((failure) => { throw brokerFailure(failure); });
    if (!shard) return false;
    const cancelled = await this.withShardLock(shard, async (lockedRedis, keys) => {
      const raw = await lockedRedis.get(keys.request(requestId));
      if (!raw) return false;
      const request = JSON.parse(raw);
      await this.writeResponse(lockedRedis, keys, request, {
        ok: false,
        error: errorRecord(error, 'BRIDGE_TIMEOUT'),
        resolvedAt: this.now(),
        resolvedByInstanceId: this.instanceId,
      });
      return true;
    });
    if (cancelled) this.log('request_cancelled', { request_id: requestId, shard, error_code: normalized(error?.code) || 'BRIDGE_TIMEOUT' });
    return cancelled;
  }

  async cancelRequestsForToken(tokenId, error = brokerError('TOKEN_REVOKED', 'Remote MCP token was revoked.')) {
    const normalizedTokenId = normalized(tokenId);
    if (!normalizedTokenId) return 0;
    const redis = await this.redis();
    const tokenKey = this.tokenRequestsKey(normalizedTokenId);
    const locators = await redis.sMembers(tokenKey).catch((error) => { throw brokerFailure(error); });
    let cancelled = 0;
    for (const locator of locators) {
      const separator = locator.indexOf('|');
      const requestId = separator >= 0 ? locator.slice(separator + 1) : '';
      if (requestId && await this.cancelRequest(requestId, error)) cancelled += 1;
    }
    await redis.del(tokenKey).catch((error) => { throw brokerFailure(error); });
    return cancelled;
  }

  async waitForResult(requestId, shard, expiresAt) {
    const redis = await this.redis();
    const keys = this.keys(shard);
    try {
      while (this.now() <= expiresAt + POLL_INTERVAL_MS) {
        const raw = await redis.get(keys.response(requestId));
        if (raw) {
          await redis.del(keys.response(requestId));
          await redis.del(this.requestIndexKey(requestId));
          this.requestShards.delete(requestId);
          const response = JSON.parse(raw);
          this.log('request_completed', {
            request_id: requestId,
            shard,
            created_instance_id: this.instanceId,
            resolve_instance_id: response.resolvedByInstanceId,
            latency_ms: Math.max(0, this.now() - Number(response.createdAt || this.now())),
            outcome: response.ok ? 'ok' : 'error',
          });
          if (!response.ok) throw responseError(response.error);
          return response.result;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      if (error?.diagramBrokerResponse) throw error;
      throw brokerFailure(error);
    }
    this.requestShards.delete(requestId);
    throw brokerError('BRIDGE_TIMEOUT', 'Diagram bridge request expired before the browser responded.');
  }

  async getPresence(client = {}) {
    const shards = new Set([
      shardForScope(client.workspaceId, client.bindingId),
      shardForWorkspace(client.workspaceId),
      'unscoped',
    ]);
    for (const shard of shards) {
      const presence = await this.withShardLock(shard, async (redis, keys) => {
      const now = this.now();
      await this.cleanup(redis, keys, now);
      const clients = await this.activeClients(redis, keys, now);
      const matching = clients.filter((candidate) => requestTargetsClient({ scope: client }, candidate));
      const active = matching.sort((left, right) => (
        Number(right.focused) - Number(left.focused)
        || right.seenAt - left.seenAt
        || right.seenSequence - left.seenSequence
      ))[0] || null;
      if (!active) return null;
      const compatibility = diagramAgentBuildCompatibility(active);
      return {
        online: true,
        connected: compatibility.compatible,
        writable: compatibility.compatible,
        status: compatibility.compatible ? 'connected' : 'stale',
        expected: compatibility.expected,
        actual: compatibility.actual,
        versionCompatible: compatibility.compatible,
        ...publicClient(active),
      };
      });
      if (presence) return presence;
    }
    return null;
  }

  async snapshot({ workspaceId = '', bindingId = '' } = {}) {
    const shards = new Set([
      shardForScope(workspaceId, bindingId),
      shardForWorkspace(workspaceId),
      'unscoped',
    ]);
    const snapshots = [];
    for (const shard of shards) {
      snapshots.push(await this.withShardLock(shard, async (lockedRedis, keys) => {
        const now = this.now();
        await this.cleanup(lockedRedis, keys, now);
        return {
          pending: Number(await lockedRedis.zCard(keys.pending)),
          active: Number(await lockedRedis.zCard(keys.expiries)) - Number(await lockedRedis.zCard(keys.pending)),
          clients: (await this.activeClients(lockedRedis, keys, now)).map(publicClient),
          shard,
        };
      }));
    }
    return {
      pending: snapshots.reduce((total, snapshot) => total + snapshot.pending, 0),
      active: snapshots.reduce((total, snapshot) => total + snapshot.active, 0),
      clients: snapshots.flatMap((snapshot) => snapshot.clients),
      shard: snapshots.map((snapshot) => snapshot.shard).join(','),
      instanceId: this.instanceId,
    };
  }

  async close() {
    if (!this.clientPromise || this.injectedClient) return;
    const client = await this.clientPromise.catch(() => null);
    if (client?.isOpen) client.destroy();
    this.clientPromise = null;
  }
}

export function createRedisDiagramAgentTransport(options) {
  return new RedisDiagramAgentTransport(options);
}

export const DIAGRAM_AGENT_REDIS_CLIENT_TTL_MS = CLIENT_TTL_MS;
