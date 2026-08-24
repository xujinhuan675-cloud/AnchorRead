'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  createTranslator,
  DEFAULT_LOCALE,
  I18N_LOCALE_STORAGE_KEY,
  persistLocale,
  resolveLocale,
} from '@/lib/i18n/index.js';

const LocaleContext = createContext(null);
const localeListeners = new Set();

function getLocaleSnapshot() {
  return resolveLocale();
}

function subscribeLocale(listener) {
  localeListeners.add(listener);

  const handleStorage = (event) => {
    if (event.key === I18N_LOCALE_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', handleStorage);

  return () => {
    localeListeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
}

function emitLocaleChange() {
  localeListeners.forEach((listener) => listener());
}

// 全局语言上下文：locale 状态集中于此，顶栏切换后全站组件经 useLocale() 重渲染；
// 初始值与 SSR 一致（zh-CN），挂载后从 localStorage/navigator 同步，避免 hydration 不匹配
export function LocaleProvider({ children }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocaleSnapshot, () => DEFAULT_LOCALE);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next) => {
    persistLocale(next);
    document.documentElement.lang = next;
    emitLocaleChange();
  }, []);

  const value = useMemo(
    () => ({
      locale,
      t: createTranslator(locale),
      setLocale,
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale 必须在 LocaleProvider 内使用');
  return ctx;
}
