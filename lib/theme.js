/**
 * 明暗主题持久化（移植自 infinite-canvas whiteboard 的 use-theme-store，
 * 改写为零依赖版本：whiteboard 用 zustand persist，这里用 localStorage + DOM class）
 * - 主题名：light | dark，存储键 anchor-read-theme（whiteboard 为 infinite-canvas:theme_store）
 * - 应用主题 = 切换 <html> 的 dark 类 + 同步 colorScheme，与 whiteboard 行为一致
 * - 默认 light：AnchorRead 现状为浅色界面，whiteboard 默认 dark 不适用，故改写
 */
import { useEffect, useState } from 'react';

export const THEME_STORAGE_KEY = 'anchor-read-theme';
export const DEFAULT_THEME = 'light';

export function readStoredTheme(storage) {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return DEFAULT_THEME;
  return store.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : DEFAULT_THEME;
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function persistTheme(theme, { storage } = {}) {
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return;
  store.setItem(THEME_STORAGE_KEY, theme === 'dark' ? 'dark' : 'light');
}

/** 主题状态 hook：初始值与 layout 内联防闪烁脚本保持一致，挂载后从 localStorage 同步 */
export function useAppTheme() {
  const [theme, setThemeState] = useState(DEFAULT_THEME);

  useEffect(() => {
    setThemeState(readStoredTheme());
  }, []);

  const setTheme = (next) => {
    const value = next === 'dark' ? 'dark' : 'light';
    persistTheme(value);
    applyTheme(value);
    setThemeState(value);
  };

  return { theme, setTheme };
}
