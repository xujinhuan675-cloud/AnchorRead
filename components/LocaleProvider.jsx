'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { createTranslator, persistLocale, resolveLocale } from '@/lib/i18n/index.js';

const LocaleContext = createContext(null);

// 全局语言上下文：locale 状态集中于此，顶栏切换后全站组件经 useLocale() 重渲染；
// 初始值与 SSR 一致（zh-CN），挂载后从 localStorage/navigator 同步，避免 hydration 不匹配
export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState('zh-CN');

  useEffect(() => {
    const resolved = resolveLocale();
    setLocaleState(resolved);
    if (typeof document !== 'undefined') document.documentElement.lang = resolved;
  }, []);

  const value = useMemo(
    () => ({
      locale,
      t: createTranslator(locale),
      setLocale: (next) => {
        persistLocale(next);
        setLocaleState(next);
        if (typeof document !== 'undefined') document.documentElement.lang = next;
      },
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale 必须在 LocaleProvider 内使用');
  return ctx;
}
