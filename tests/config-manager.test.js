import test from 'node:test';
import assert from 'node:assert/strict';

import ConfigManager, { OFFICIAL_CHANNEL_ID, OFFICIAL_CHANNEL_BASE_URL } from '../lib/config-manager.js';

/** 内存版 localStorage，避免测试依赖浏览器环境 */
function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function withBrowserEnv(fn) {
  globalThis.window = { localStorage: createMemoryStorage() };
  globalThis.localStorage = globalThis.window.localStorage;
  try {
    return fn(globalThis.localStorage);
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
}

test('首次加载预置官方渠道，且作为唯一配置自动成为当前配置', () => {
  withBrowserEnv((storage) => {
    const manager = new ConfigManager();
    const configs = manager.getAllConfigs();

    assert.equal(configs.length, 1);
    const official = configs[0];
    assert.equal(official.id, OFFICIAL_CHANNEL_ID);
    assert.equal(official.name, '官方渠道');
    assert.equal(official.baseUrl, OFFICIAL_CHANNEL_BASE_URL);
    assert.equal(official.isOfficial, true);
    assert.equal(manager.getActiveConfigId(), OFFICIAL_CHANNEL_ID);

    // 预设结果持久化到 localStorage，且种入标记生效
    const stored = JSON.parse(storage.getItem('smart-excalidraw-configs'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, OFFICIAL_CHANNEL_ID);
    assert.equal(storage.getItem('smart-excalidraw-official-seeded'), 'true');
  });
});

test('重复加载不重复种入；用户删除后不再恢复', () => {
  withBrowserEnv(() => {
    const manager = new ConfigManager();
    manager.getAllConfigs();

    // 模拟页面重新打开：新实例加载同一份存储，不应再新增
    const reloaded = new ConfigManager();
    assert.equal(reloaded.getAllConfigs().length, 1);

    // 用户显式删除官方渠道后，后续加载不再恢复
    reloaded.deleteConfig(OFFICIAL_CHANNEL_ID);
    const afterDelete = new ConfigManager();
    assert.equal(afterDelete.getAllConfigs().length, 0);
  });
});

test('已有自定义配置的存量用户也会补种一次官方渠道', () => {
  withBrowserEnv((storage) => {
    storage.setItem('smart-excalidraw-configs', JSON.stringify([{
      id: 'user-config',
      name: '我的 OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4',
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]));

    const manager = new ConfigManager();
    const configs = manager.getAllConfigs();
    assert.equal(configs.length, 2);
    assert.equal(configs[0].id, OFFICIAL_CHANNEL_ID);
    assert.equal(configs[1].id, 'user-config');
  });
});

test('克隆官方渠道得到的副本不再带官方标记', () => {
  withBrowserEnv(() => {
    const manager = new ConfigManager();
    manager.getAllConfigs();

    const cloned = manager.cloneConfig(OFFICIAL_CHANNEL_ID);
    assert.equal(cloned.isOfficial, undefined);
    assert.equal(cloned.baseUrl, OFFICIAL_CHANNEL_BASE_URL);
    assert.notEqual(cloned.id, OFFICIAL_CHANNEL_ID);
  });
});
