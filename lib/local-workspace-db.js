export const WORKSPACE_DB_NAME = 'anchor-read-workspace';
export const WORKSPACE_DB_VERSION = 3;

export const WORKSPACE_SCHEMA = Object.freeze({
  documents: Object.freeze({
    keyPath: 'id',
    indexes: Object.freeze({
      updatedAt: Object.freeze({ keyPath: 'updatedAt' }),
      status: Object.freeze({ keyPath: 'status' }),
    }),
  }),
  readSessions: Object.freeze({
    keyPath: 'id',
    indexes: Object.freeze({
      documentId: Object.freeze({ keyPath: 'documentId', unique: true }),
      updatedAt: Object.freeze({ keyPath: 'updatedAt' }),
    }),
  }),
  drawings: Object.freeze({
    keyPath: 'id',
    indexes: Object.freeze({
      documentId: Object.freeze({ keyPath: 'documentId' }),
      engine: Object.freeze({ keyPath: 'engine' }),
      updatedAt: Object.freeze({ keyPath: 'updatedAt' }),
    }),
  }),
  explanations: Object.freeze({
    keyPath: 'id',
    indexes: Object.freeze({
      documentId: Object.freeze({ keyPath: 'documentId' }),
      updatedAt: Object.freeze({ keyPath: 'updatedAt' }),
    }),
  }),
  terms: Object.freeze({
    keyPath: 'id',
    indexes: Object.freeze({
      documentId: Object.freeze({ keyPath: 'documentId' }),
      normalizedTerm: Object.freeze({ keyPath: 'normalizedTerm' }),
      updatedAt: Object.freeze({ keyPath: 'updatedAt' }),
    }),
  }),
  reviewStates: Object.freeze({
    keyPath: 'id',
    indexes: Object.freeze({
      documentId: Object.freeze({ keyPath: 'documentId' }),
      dueAt: Object.freeze({ keyPath: 'dueAt' }),
      updatedAt: Object.freeze({ keyPath: 'updatedAt' }),
    }),
  }),
  customActions: Object.freeze({
    keyPath: 'id',
    indexes: Object.freeze({
      updatedAt: Object.freeze({ keyPath: 'updatedAt' }),
    }),
  }),
  glossary: Object.freeze({
    keyPath: 'id',
    indexes: Object.freeze({
      normalizedTerm: Object.freeze({ keyPath: 'normalizedTerm' }),
      updatedAt: Object.freeze({ keyPath: 'updatedAt' }),
    }),
  }),
});

export const WORKSPACE_STORE_NAMES = Object.freeze(Object.keys(WORKSPACE_SCHEMA));

function assertStoreName(storeName) {
  if (!Object.hasOwn(WORKSPACE_SCHEMA, storeName)) {
    throw new TypeError(`Unknown workspace store: ${storeName}`);
  }
}

function cloneValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function defaultGenerateId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function finiteTimestamp(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function normalizeWorkspaceRecord(
  storeName,
  record,
  { now = Date.now(), generateId = defaultGenerateId } = {}
) {
  assertStoreName(storeName);
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('Workspace records must be plain objects.');
  }

  const normalized = cloneValue(record);
  const id = typeof normalized.id === 'string' ? normalized.id.trim() : '';
  normalized.id = id || generateId();
  normalized.createdAt = finiteTimestamp(normalized.createdAt, now);
  normalized.updatedAt = finiteTimestamp(normalized.updatedAt, now);

  if ('documentId' in normalized) {
    normalized.documentId = typeof normalized.documentId === 'string'
      ? normalized.documentId.trim()
      : '';
  }

  if (storeName === 'documents') {
    normalized.title = typeof normalized.title === 'string'
      ? normalized.title.trim()
      : '';
    normalized.status = normalized.status === 'archived' ? 'archived' : 'active';
  }

  if (storeName === 'drawings' && normalized.engine !== undefined) {
    if (!['excalidraw', 'mermaid'].includes(normalized.engine)) {
      throw new TypeError('Drawing engine must be "excalidraw" or "mermaid".');
    }
  }

  if (storeName === 'terms') {
    if (typeof normalized.term === 'string') {
      normalized.term = normalized.term.trim();
      normalized.normalizedTerm = normalized.term.toLowerCase();
    }
    // 别名规整：trim、小写、去重，并剔除与主术语重复项
    const aliasSeed = Array.isArray(normalized.aliases) ? normalized.aliases : [];
    const seenAliases = new Set(
      normalized.normalizedTerm ? [normalized.normalizedTerm] : []
    );
    normalized.aliases = aliasSeed.flatMap((alias) => {
      const compact = typeof alias === 'string' ? alias.trim().toLowerCase() : '';
      if (!compact || seenAliases.has(compact)) return [];
      seenAliases.add(compact);
      return [compact];
    });
    // 掌握状态：mastered 表示用户已懂，跨文档再次出现时不再解释（辅助层渐隐）
    normalized.status = normalized.status === 'mastered' ? 'mastered' : 'learning';
  }

  if (storeName === 'reviewStates' && normalized.dueAt === undefined) {
    normalized.dueAt = finiteTimestamp(normalized.due, now);
  }

  if (storeName === 'customActions') {
    normalized.name = typeof normalized.name === 'string' ? normalized.name.trim() : '';
    normalized.promptTemplate = typeof normalized.promptTemplate === 'string'
      ? normalized.promptTemplate.trim()
      : '';
    normalized.enabled = normalized.enabled !== false;
  }

  if (storeName === 'glossary') {
    // 术语表条目：term 必填且 trim；explanation 为用户自维护的定义，作为 AI 背景交代
    normalized.term = typeof normalized.term === 'string' ? normalized.term.trim() : '';
    if (!normalized.term) {
      throw new TypeError('术语表条目的主术语不能为空。');
    }
    normalized.normalizedTerm = normalized.term.toLowerCase();
    normalized.explanation = typeof normalized.explanation === 'string'
      ? normalized.explanation.trim()
      : '';
    // 别名规整：trim、小写、去重，并剔除与主术语重复项
    const glossaryAliasSeed = Array.isArray(normalized.aliases) ? normalized.aliases : [];
    const glossarySeenAliases = new Set([normalized.normalizedTerm]);
    normalized.aliases = glossaryAliasSeed.flatMap((alias) => {
      const compact = typeof alias === 'string' ? alias.trim().toLowerCase() : '';
      if (!compact || glossarySeenAliases.has(compact)) return [];
      glossarySeenAliases.add(compact);
      return [compact];
    });
  }

  return normalized;
}

function unavailableIndexedDbError() {
  const error = new Error('IndexedDB is unavailable in this environment.');
  error.code = 'INDEXEDDB_UNAVAILABLE';
  return error;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function applySchema(database, transaction, schema) {
  for (const [storeName, definition] of Object.entries(schema)) {
    const objectStore = database.objectStoreNames.contains(storeName)
      ? transaction.objectStore(storeName)
      : database.createObjectStore(storeName, { keyPath: definition.keyPath });

    for (const [indexName, indexDefinition] of Object.entries(definition.indexes || {})) {
      if (!objectStore.indexNames.contains(indexName)) {
        objectStore.createIndex(indexName, indexDefinition.keyPath, {
          unique: Boolean(indexDefinition.unique),
          multiEntry: Boolean(indexDefinition.multiEntry),
        });
      }
    }
  }
}

function openCursorList(source, { query, direction = 'next', limit } = {}) {
  const maxResults = Number.isInteger(limit) && limit >= 0 ? limit : Infinity;
  if (maxResults === 0) return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    const records = [];
    const request = source.openCursor(query, direction);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || records.length >= maxResults) {
        resolve(records);
        return;
      }
      records.push(cursor.value);
      cursor.continue();
    };
  });
}

export function createIndexedDbWorkspaceAdapter({
  indexedDB: indexedDbFactory = globalThis.indexedDB,
  dbName = WORKSPACE_DB_NAME,
  version = WORKSPACE_DB_VERSION,
  schema = WORKSPACE_SCHEMA,
} = {}) {
  let databasePromise = null;

  function open() {
    if (!indexedDbFactory) return Promise.reject(unavailableIndexedDbError());
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDbFactory.open(dbName, version);
      request.onupgradeneeded = () => {
        applySchema(request.result, request.transaction, schema);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        const error = new Error(`Opening IndexedDB database "${dbName}" was blocked.`);
        error.code = 'INDEXEDDB_BLOCKED';
        reject(error);
      };
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });

    return databasePromise;
  }

  async function withStore(storeName, mode, operation) {
    assertStoreName(storeName);
    const database = await open();
    const transaction = database.transaction(storeName, mode);
    const transactionDone = mode === 'readwrite'
      ? transactionToPromise(transaction)
      : null;
    try {
      const result = await operation(transaction.objectStore(storeName));
      if (transactionDone) await transactionDone;
      return result;
    } catch (error) {
      if (transactionDone) await transactionDone.catch(() => {});
      throw error;
    }
  }

  return {
    kind: 'indexeddb',
    isAvailable: () => Boolean(indexedDbFactory),
    open,

    get(storeName, id) {
      return withStore(storeName, 'readonly', (store) => requestToPromise(store.get(id)));
    },

    put(storeName, record) {
      return withStore(storeName, 'readwrite', async (store) => {
        await requestToPromise(store.put(record));
        return cloneValue(record);
      });
    },

    list(storeName, options = {}) {
      return withStore(storeName, 'readonly', (store) => {
        const source = options.index ? store.index(options.index) : store;
        return openCursorList(source, options);
      });
    },

    delete(storeName, id) {
      return withStore(storeName, 'readwrite', async (store) => {
        const existing = await requestToPromise(store.get(id));
        await requestToPromise(store.delete(id));
        return existing !== undefined;
      });
    },

    clear(storeName) {
      return withStore(storeName, 'readwrite', async (store) => {
        await requestToPromise(store.clear());
      });
    },

    async clearAll() {
      const database = await open();
      const transaction = database.transaction(WORKSPACE_STORE_NAMES, 'readwrite');
      for (const storeName of WORKSPACE_STORE_NAMES) {
        transaction.objectStore(storeName).clear();
      }
      await transactionToPromise(transaction);
    },

    async close() {
      if (!databasePromise) return;
      const database = await databasePromise;
      database.close();
      databasePromise = null;
    },
  };
}

function compareKeys(left, right) {
  if (left === right) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return left < right ? -1 : 1;
}

export function createMemoryWorkspaceAdapter(initialState = {}) {
  const stores = new Map(
    WORKSPACE_STORE_NAMES.map((storeName) => [
      storeName,
      new Map((initialState[storeName] || []).map((record) => [record.id, cloneValue(record)])),
    ])
  );

  function getStore(storeName) {
    assertStoreName(storeName);
    return stores.get(storeName);
  }

  return {
    kind: 'memory',
    isAvailable: () => true,
    async open() {
      return this;
    },
    async get(storeName, id) {
      return cloneValue(getStore(storeName).get(id));
    },
    async put(storeName, record) {
      getStore(storeName).set(record.id, cloneValue(record));
      return cloneValue(record);
    },
    async list(storeName, { index, query, direction = 'next', limit } = {}) {
      const store = getStore(storeName);
      const indexName = index || WORKSPACE_SCHEMA[storeName].keyPath;
      if (index && !Object.hasOwn(WORKSPACE_SCHEMA[storeName].indexes, index)) {
        throw new TypeError(`Unknown index "${index}" for workspace store "${storeName}".`);
      }
      let records = Array.from(store.values());
      if (query !== undefined) {
        records = records.filter((record) => record[indexName] === query);
      }
      records.sort((left, right) => compareKeys(left[indexName], right[indexName]));
      if (direction.startsWith('prev')) records.reverse();
      if (Number.isInteger(limit) && limit >= 0) records = records.slice(0, limit);
      return cloneValue(records);
    },
    async delete(storeName, id) {
      return getStore(storeName).delete(id);
    },
    async clear(storeName) {
      getStore(storeName).clear();
    },
    async clearAll() {
      for (const store of stores.values()) store.clear();
    },
    async close() {},
  };
}

function createCollectionRepository(storeName, adapter, normalizeOptions) {
  return Object.freeze({
    get: (id) => adapter.get(storeName, id),
    save: (record) => adapter.put(
      storeName,
      normalizeWorkspaceRecord(storeName, record, normalizeOptions)
    ),
    list: (options) => adapter.list(storeName, options),
    remove: (id) => adapter.delete(storeName, id),
    clear: () => adapter.clear(storeName),
  });
}

export function createWorkspaceRepository(
  adapter = createIndexedDbWorkspaceAdapter(),
  normalizeOptions = {}
) {
  if (!adapter || ['get', 'put', 'list', 'delete', 'clear'].some(
    (method) => typeof adapter[method] !== 'function'
  )) {
    throw new TypeError('A workspace storage adapter with async CRUD methods is required.');
  }

  const collections = Object.fromEntries(
    WORKSPACE_STORE_NAMES.map((storeName) => [
      storeName,
      createCollectionRepository(storeName, adapter, normalizeOptions),
    ])
  );

  return Object.freeze({
    adapter,
    ...collections,
    get: (storeName, id) => {
      assertStoreName(storeName);
      return adapter.get(storeName, id);
    },
    save: (storeName, record) => {
      assertStoreName(storeName);
      return adapter.put(
        storeName,
        normalizeWorkspaceRecord(storeName, record, normalizeOptions)
      );
    },
    list: (storeName, options) => {
      assertStoreName(storeName);
      return adapter.list(storeName, options);
    },
    remove: (storeName, id) => {
      assertStoreName(storeName);
      return adapter.delete(storeName, id);
    },
    clear: (storeName) => {
      assertStoreName(storeName);
      return adapter.clear(storeName);
    },
    clearAll: () => typeof adapter.clearAll === 'function'
      ? adapter.clearAll()
      : Promise.all(WORKSPACE_STORE_NAMES.map((storeName) => adapter.clear(storeName))),
  });
}

export const workspaceRepository = createWorkspaceRepository();
