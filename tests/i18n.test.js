import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOCALE,
  registerDictionary,
  createTranslator,
  resolveLocale,
  persistLocale,
  clearDictionaries,
  I18N_LOCALE_STORAGE_KEY,
} from '../lib/i18n.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('翻译命中当前语言并支持 {name} 插值', () => {
  clearDictionaries();
  registerDictionary('zh-CN', { 'greeting': '你好，{name}' });
  const t = createTranslator('zh-CN');
  assert.equal(t('greeting', { name: '阅读者' }), '你好，阅读者');
});

test('缺失 key 时回退到默认语言，再回退到 key 本身', () => {
  clearDictionaries();
  registerDictionary('zh-CN', { 'only-zh': '只有中文', 'shared': '共享中文' });
  registerDictionary('en', { 'shared': 'shared-en' });

  const tEn = createTranslator('en');
  assert.equal(tEn('shared'), 'shared-en');
  assert.equal(tEn('only-zh'), '只有中文');
  assert.equal(tEn('missing.key'), 'missing.key');
});

test('语言回退链：en-US -> en -> zh-CN', () => {
  clearDictionaries();
  registerDictionary('zh-CN', { 'fallback': '中文兜底' });
  registerDictionary('en', { 'fallback-en': 'en value' });

  const tUs = createTranslator('en-US');
  assert.equal(tUs('fallback-en'), 'en value');
  assert.equal(tUs('fallback'), '中文兜底');
});

test('resolveLocale 按 explicit > storage > navigator 优先级解析', () => {
  clearDictionaries();
  registerDictionary('zh-CN', {});
  registerDictionary('en', {});

  const storage = createMemoryStorage();
  storage.setItem(I18N_LOCALE_STORAGE_KEY, 'en');

  assert.equal(resolveLocale({ explicit: 'zh-CN', storage }), 'zh-CN');
  assert.equal(resolveLocale({ storage }), 'en');
  assert.equal(resolveLocale({ navigatorLike: { language: 'en-US' } }), 'en');
  assert.equal(resolveLocale({ navigatorLike: { language: 'fr' } }), DEFAULT_LOCALE);
});

test('persistLocale 写入 storage', () => {
  const storage = createMemoryStorage();
  persistLocale('en', { storage });
  assert.equal(storage.getItem(I18N_LOCALE_STORAGE_KEY), 'en');
});

test('内置语言包注册后可互相回退', async () => {
  const { t, createTranslator: build } = await import('../lib/i18n/index.js');
  assert.equal(t('common.save'), '保存');
  assert.equal(build('en')('common.save'), 'Save');
  assert.equal(build('en')('不存在的key'), '不存在的key');
});
