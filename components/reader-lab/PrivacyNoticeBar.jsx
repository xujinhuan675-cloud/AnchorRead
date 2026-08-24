'use client';

import { Download, ShieldCheck, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useLocale } from '@/components/LocaleProvider';

// 关闭后的抑制策略：当天不再弹出，次日起重新显示，避免永久静默忘掉隐私承诺
const DISMISS_STORAGE_KEY = 'anchor-read-privacy-dismissed-date';

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

const noticeListeners = new Set();
const subscribeToHydration = () => () => {};

function isNoticeVisible() {
  return localStorage.getItem(DISMISS_STORAGE_KEY) !== todayKey();
}

function subscribeToNotice(listener) {
  noticeListeners.add(listener);

  const handleStorage = (event) => {
    if (event.key === DISMISS_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', handleStorage);

  return () => {
    noticeListeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
}

function emitNoticeChange() {
  noticeListeners.forEach((listener) => listener());
}

/**
 * 全局隐私提示横幅：所有页面统一显示，含免费卖点与宣传语，
 * 告知数据仅存本地并提供一键导出备份入口；可关闭，当天内不再显示
 */
export default function PrivacyNoticeBar({ onExport }) {
  const { t } = useLocale();
  // 初始为 true 避免服务端/首帧闪烁；挂载后再按本地记录判断是否当天已关闭
  const visible = useSyncExternalStore(subscribeToNotice, isNoticeVisible, () => true);
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);

  const dismiss = () => {
    localStorage.setItem(DISMISS_STORAGE_KEY, todayKey());
    emitNoticeChange();
  };

  if (!visible) return null;

  return (
    <div className="flex min-h-8 shrink-0 items-center gap-2 border-b border-stone-200 bg-stone-100 px-3 text-[11px] leading-4 text-stone-600 sm:px-4 dark:border-stone-800 dark:bg-white/5 dark:text-stone-400">
      <ShieldCheck size={13} className="shrink-0 text-stone-500 dark:text-stone-400" aria-hidden="true" />
      {/* 单行展示：窄屏末尾截断，不折行挤压工作区 */}
      <span className="truncate">
        {t('privacy.notice')}
      </span>
      <button
        type="button"
        onClick={onExport}
        className="ml-auto hidden shrink-0 items-center gap-1 font-medium text-stone-950 transition hover:text-stone-600 sm:flex dark:text-stone-100 dark:hover:text-stone-300"
      >
        <Download size={12} /> {t('common.export')}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('privacy.dismissAria')}
        title={t('privacy.dismissTitle')}
        className={`${ready ? '' : 'invisible '}flex shrink-0 items-center justify-center rounded p-0.5 text-stone-400 transition hover:bg-black/5 hover:text-stone-700 dark:hover:bg-white/10 dark:hover:text-stone-200`}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
