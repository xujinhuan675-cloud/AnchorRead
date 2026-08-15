/**
 * i18n 基础框架（轻量、零依赖）
 * - registerDictionary(locale, messages) 注册语言包
 * - createTranslator(locale) 返回 t(key, params)，支持 {name} 插值与回退链
 * - 回退顺序：当前语言 -> zh-CN 默认语言 -> key 本身
 * 组件可结合 React context 使用；此处只提供与 UI 解耦的核心能力，便于测试。
 */

export const DEFAULT_LOCALE = 'zh-CN';
export const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en']);
export const I18N_LOCALE_STORAGE_KEY = 'anchor-read-locale';

const dictionaries = new Map();

export function registerDictionary(locale, messages = {}) {
  if (typeof locale !== 'string' || !locale.trim()) {
    throw new Error('registerDictionary 需要有效的 locale。');
  }
  dictionaries.set(locale, { ...(dictionaries.get(locale) || {}), ...messages });
}

export function getRegisteredLocales() {
  return [...dictionaries.keys()];
}

/** 语言回退链：如 'en-US' -> 'en' -> DEFAULT_LOCALE */
function localeChain(locale) {
  const chain = [];
  const normalized = String(locale || '').trim();
  if (normalized) {
    chain.push(normalized);
    const primary = normalized.split('-')[0];
    if (primary !== normalized) chain.push(primary);
  }
  if (!chain.includes(DEFAULT_LOCALE)) chain.push(DEFAULT_LOCALE);
  return chain;
}

export function createTranslator(locale = DEFAULT_LOCALE) {
  return function t(key, params = {}) {
    for (const candidate of localeChain(locale)) {
      const messages = dictionaries.get(candidate);
      if (messages && typeof messages[key] === 'string') {
        return messages[key].replace(/\{(\w+)\}/g, (match, name) => (
          params[name] !== undefined ? String(params[name]) : match
        ));
      }
    }
    return key;
  };
}

/** 读取当前语言：显式传入 > localStorage > navigator > 默认 */
export function resolveLocale({ explicit, storage, navigatorLike } = {}) {
  const candidates = [explicit];
  if (storage) candidates.push(storage.getItem(I18N_LOCALE_STORAGE_KEY));
  const nav = navigatorLike || (typeof navigator !== 'undefined' ? navigator : null);
  if (nav?.language) candidates.push(nav.language);
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    if (dictionaries.has(value)) return value;
    const primary = value.split('-')[0];
    if (dictionaries.has(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

export function persistLocale(locale, { storage } = {}) {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return;
  store.setItem(I18N_LOCALE_STORAGE_KEY, String(locale || ''));
}

/** 清空注册表（仅供测试使用） */
export function clearDictionaries() {
  dictionaries.clear();
}
