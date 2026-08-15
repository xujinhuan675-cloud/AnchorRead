/**
 * i18n 入口：注册内置语言包并导出默认翻译器。
 * 使用：import { t, resolveLocale } from '@/lib/i18n' （本文件副作用注册词典）
 */

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  I18N_LOCALE_STORAGE_KEY,
  registerDictionary,
  getRegisteredLocales,
  createTranslator,
  resolveLocale,
  persistLocale,
  clearDictionaries,
} from '../i18n.js';
import zhCN from './zh-CN.js';
import en from './en.js';

registerDictionary('zh-CN', zhCN);
registerDictionary('en', en);

/** 默认翻译器（zh-CN）；运行时切换语言请用 createTranslator(resolveLocale()) */
export const t = createTranslator(DEFAULT_LOCALE);

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  I18N_LOCALE_STORAGE_KEY,
  registerDictionary,
  getRegisteredLocales,
  createTranslator,
  resolveLocale,
  persistLocale,
  clearDictionaries,
};
