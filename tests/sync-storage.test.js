import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SyncStorageError,
  createBrowserSlotAdapter,
  createWebDavAdapter,
  pickSyncAdapter,
  loadSyncConfig,
  saveSyncConfig,
} from '../lib/sync-storage.js';
import {
  pushWorkspace,
  pullWorkspace,
  peekRemoteExportedAt,
  resolveSyncDirection,
} from '../lib/sync-manager.js';
import {
  createMemoryWorkspaceAdapter,
  createWorkspaceRepository,
} from '../lib/local-workspace-db.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function createFetchMock(handler) {
  return async (url, options) => handler(url, options || {});
}

test('browser-slot 适配器在 localStorage 中保存与读取', async () => {
  const storage = createMemoryStorage();
  globalThis.window = { localStorage: storage };
  try {
    const adapter = createBrowserSlotAdapter();
    assert.equal(adapter.available(), true);
    assert.equal(await adapter.load(), null);
    await adapter.save('{"type":"anchor-read-workspace"}');
    assert.equal(await adapter.load(), '{"type":"anchor-read-workspace"}');
    await adapter.clear();
    assert.equal(await adapter.load(), null);
  } finally {
    delete globalThis.window;
  }
});

test('webdav 适配器：load 404 返回 null、200 返回正文、非 2xx 抛错', async () => {
  const notFound = createWebDavAdapter(
    { url: 'https://dav.example.com/a.json' },
    { fetchImpl: createFetchMock(() => ({ status: 404, ok: false, text: async () => '' })) }
  );
  assert.equal(await notFound.load(), null);

  const ok = createWebDavAdapter(
    { url: 'https://dav.example.com/a.json' },
    { fetchImpl: createFetchMock(() => ({ status: 200, ok: true, text: async () => '{"hello":1}' })) }
  );
  assert.equal(await ok.load(), '{"hello":1}');

  const denied = createWebDavAdapter(
    { url: 'https://dav.example.com/a.json' },
    { fetchImpl: createFetchMock(() => ({ status: 401, ok: false, text: async () => '' })) }
  );
  await assert.rejects(() => denied.load(), SyncStorageError);
});

test('webdav 适配器：save 携带 Basic 认证头并识别 201/204 成功', async () => {
  const calls = [];
  const adapter = createWebDavAdapter(
    { url: 'https://dav.example.com/a.json', username: 'u', password: 'p' },
    {
      fetchImpl: createFetchMock((url, options) => {
        calls.push({ url, options });
        return { status: 201, ok: false, text: async () => '' };
      }),
    }
  );
  await adapter.save('payload');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.body, 'payload');
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('u:p').toString('base64')}`);

  const forbidden = createWebDavAdapter(
    { url: 'https://dav.example.com/a.json' },
    { fetchImpl: createFetchMock(() => ({ status: 403, ok: false, text: async () => '' })) }
  );
  await assert.rejects(() => forbidden.save('x'), SyncStorageError);
});

test('webdav 适配器拒绝空地址与非 http(s) 地址', () => {
  assert.throws(() => createWebDavAdapter({ url: '' }), SyncStorageError);
  assert.throws(() => createWebDavAdapter({ url: 'ftp://dav.example.com/a.json' }), SyncStorageError);
});

test('pickSyncAdapter 按 provider 选择适配器', () => {
  globalThis.window = { localStorage: createMemoryStorage() };
  try {
    const slot = pickSyncAdapter({ provider: 'browser-slot' });
    assert.equal(slot.id, 'browser-slot');
  } finally {
    delete globalThis.window;
  }
  const webdav = pickSyncAdapter({ provider: 'webdav', webdav: { url: 'https://dav.example.com/a.json' } });
  assert.equal(webdav.id, 'webdav');
  assert.throws(() => pickSyncAdapter({ provider: 'unknown' }), SyncStorageError);
});

test('同步配置持久化：保存后能读回，坏 JSON 回退默认值', () => {
  const storage = createMemoryStorage();
  saveSyncConfig({ provider: 'webdav', webdav: { url: 'https://x/a.json', username: 'u', password: 'p' }, lastSyncAt: 7 }, { storage });
  const loaded = loadSyncConfig({ storage });
  assert.equal(loaded.provider, 'webdav');
  assert.equal(loaded.webdav.url, 'https://x/a.json');
  assert.equal(loaded.lastSyncAt, 7);

  storage.setItem('anchor-read-sync-config', '{broken');
  assert.equal(loadSyncConfig({ storage }).provider, 'browser-slot');
});

test('pushWorkspace/pullWorkspace 在两个工作区间往返', async () => {
  const remote = { value: null };
  const adapter = {
    id: 'fake',
    label: 'fake',
    available: () => true,
    load: async () => remote.value,
    save: async (payload) => {
      remote.value = payload;
    },
  };

  const source = createWorkspaceRepository(createMemoryWorkspaceAdapter(), {
    now: 10,
    generateId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  await source.documents.save({ title: '文档 A', content: '内容' });
  await source.customActions.save({ name: '翻译', promptTemplate: '解释 {{selection}}' });

  const syncedAt = await pushWorkspace(adapter, source, {}, { now: 99 });
  assert.equal(syncedAt, 99);
  assert.equal(await peekRemoteExportedAt(adapter) !== null, true);

  const target = createWorkspaceRepository(createMemoryWorkspaceAdapter(), {
    now: 20,
    generateId: () => 'should-not-be-used',
  });
  const { count } = await pullWorkspace(adapter, target, { replace: true });
  assert.ok(count >= 2);
  const docs = await target.documents.list();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].title, '文档 A');
  const actions = await target.customActions.list();
  assert.equal(actions[0].name, '翻译');
});

test('pullWorkspace 远端为空时抛错，resolveSyncDirection 比较时间戳', async () => {
  const emptyAdapter = { id: 'empty', available: () => true, load: async () => null };
  await assert.rejects(() => pullWorkspace(emptyAdapter, {}), SyncStorageError);

  assert.equal(resolveSyncDirection(10, 5), 'push');
  assert.equal(resolveSyncDirection(5, 10), 'pull');
  assert.equal(resolveSyncDirection(10, 10), 'same');
});

test('peekRemoteExportedAt 对损坏的远端数据抛错', async () => {
  const brokenAdapter = { id: 'broken', available: () => true, load: async () => 'not-json' };
  await assert.rejects(() => peekRemoteExportedAt(brokenAdapter), SyncStorageError);
});
