/**
 * 存储适配器抽象：把工作区备份推送到外部存储 / 从外部存储拉回。
 * 内置两个适配器：
 * - browser-slot：浏览器 localStorage 中的同步槽（跨标签页/同设备兜底）
 * - webdav：标准 WebDAV（坚果云、Alist、Nextcloud 等），通过 GET/PUT 读写单个文件
 * 新增云存储时实现同样接口并注册即可，不必改动 UI。
 */

export class SyncStorageError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'SyncStorageError';
    if (cause) this.cause = cause;
  }
}

export const SYNC_SLOT_STORAGE_KEY = 'anchor-read-sync-slot';

/** localStorage 同步槽：容量有限，仅适合小工作区兜底同步 */
export function createBrowserSlotAdapter({ storageKey = SYNC_SLOT_STORAGE_KEY } = {}) {
  return {
    id: 'browser-slot',
    label: '浏览器本地同步槽',
    description: '保存在本浏览器 localStorage，可用于同浏览器恢复，容量约 5MB。',
    available() {
      return typeof window !== 'undefined' && Boolean(window.localStorage);
    },
    async load() {
      if (!this.available()) throw new SyncStorageError('当前环境不支持 localStorage。');
      return window.localStorage.getItem(storageKey) || null;
    },
    async save(serializedPayload) {
      if (!this.available()) throw new SyncStorageError('当前环境不支持 localStorage。');
      try {
        window.localStorage.setItem(storageKey, serializedPayload);
      } catch (error) {
        throw new SyncStorageError('写入浏览器同步槽失败，可能是工作区超过 localStorage 容量上限。', { cause: error });
      }
    },
    async clear() {
      if (!this.available()) return;
      window.localStorage.removeItem(storageKey);
    },
  };
}

function buildWebDavHeaders(config) {
  const headers = {};
  const username = String(config.username || '').trim();
  const password = String(config.password || '');
  if (username || password) {
    const token = typeof btoa === 'function'
      ? btoa(`${username}:${password}`)
      : Buffer.from(`${username}:${password}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

function normalizeWebDavUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) throw new SyncStorageError('WebDAV 地址不能为空。');
  if (!/^https?:\/\//i.test(url)) throw new SyncStorageError('WebDAV 地址必须以 http:// 或 https:// 开头。');
  try {
    // 校验可解析为合法 URL（含中文路径时先编码再校验）
    new URL(url.includes(' ') ? encodeURI(url) : url);
  } catch {
    throw new SyncStorageError('WebDAV 地址不是有效的 URL。');
  }
  return url;
}

/** WebDAV 适配器：PUT 覆盖写入、GET 读取、404 视为尚无远端备份 */
export function createWebDavAdapter(config = {}, { fetchImpl } = {}) {
  const url = normalizeWebDavUrl(config.url);
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);

  return {
    id: 'webdav',
    label: 'WebDAV',
    description: '通过 WebDAV 协议同步到坚果云 / Alist / Nextcloud 等服务。',
    config,
    available() {
      return Boolean(doFetch);
    },
    async load() {
      if (!this.available()) throw new SyncStorageError('当前环境不支持 fetch。');
      let response;
      try {
        response = await doFetch(url, { method: 'GET', headers: buildWebDavHeaders(config) });
      } catch (error) {
        throw new SyncStorageError('连接 WebDAV 服务失败，请检查网络、地址与 CORS 设置。', { cause: error });
      }
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new SyncStorageError(`WebDAV 读取失败（HTTP ${response.status}），请检查账号密码与文件路径。`);
      }
      return response.text();
    },
    async save(serializedPayload) {
      if (!this.available()) throw new SyncStorageError('当前环境不支持 fetch。');
      let response;
      try {
        response = await doFetch(url, {
          method: 'PUT',
          headers: { ...buildWebDavHeaders(config), 'Content-Type': 'application/json; charset=utf-8' },
          body: serializedPayload,
        });
      } catch (error) {
        throw new SyncStorageError('连接 WebDAV 服务失败，请检查网络、地址与 CORS 设置。', { cause: error });
      }
      // WebDAV 规范：PUT 创建返回 201，覆盖返回 204/200
      if (!response.ok && response.status !== 201 && response.status !== 204) {
        throw new SyncStorageError(`WebDAV 写入失败（HTTP ${response.status}），请检查账号密码与目录权限。`);
      }
    },
    async clear() {
      if (!this.available()) return;
      try {
        await doFetch(url, { method: 'DELETE', headers: buildWebDavHeaders(config) });
      } catch (error) {
        throw new SyncStorageError('连接 WebDAV 服务失败，无法清除远端备份。', { cause: error });
      }
    },
  };
}

/** 依据同步配置构建当前可用适配器列表 */
export function getSyncAdapters(syncConfig = {}) {
  const adapters = [createBrowserSlotAdapter()];
  if (syncConfig.provider === 'webdav' && syncConfig.webdav?.url) {
    adapters.push(createWebDavAdapter(syncConfig.webdav));
  }
  return adapters;
}

export function pickSyncAdapter(syncConfig = {}) {
  const provider = syncConfig.provider || 'browser-slot';
  const adapter = getSyncAdapters(syncConfig).find((item) => item.id === provider);
  if (!adapter) throw new SyncStorageError(`未知的同步存储：${provider}`);
  if (!adapter.available()) throw new SyncStorageError(`同步存储「${adapter.label}」在当前环境不可用。`);
  return adapter;
}

/** 同步配置持久化（localStorage） */
export const SYNC_CONFIG_STORAGE_KEY = 'anchor-read-sync-config';

export function loadSyncConfig({ storage } = {}) {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return { provider: 'browser-slot', webdav: {} };
  try {
    const parsed = JSON.parse(store.getItem(SYNC_CONFIG_STORAGE_KEY) || '{}');
    return {
      provider: parsed.provider === 'webdav' ? 'webdav' : 'browser-slot',
      webdav: {
        url: typeof parsed.webdav?.url === 'string' ? parsed.webdav.url : '',
        username: typeof parsed.webdav?.username === 'string' ? parsed.webdav.username : '',
        password: typeof parsed.webdav?.password === 'string' ? parsed.webdav.password : '',
      },
      lastSyncAt: Number.isFinite(parsed.lastSyncAt) ? parsed.lastSyncAt : 0,
    };
  } catch {
    return { provider: 'browser-slot', webdav: {} };
  }
}

export function saveSyncConfig(config, { storage } = {}) {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return;
  store.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify(config));
}
