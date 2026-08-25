'use client';

import { BookMarked, BookOpenText, Library, Menu, Network, PlugZap, Settings2, WandSparkles, X } from 'lucide-react';
import { useState } from 'react';

import ThemeToggler from './ThemeToggler';
import McpConnectionPanel from './McpConnectionPanel';
import { useLocale } from './LocaleProvider';
import { useAppTheme } from '@/lib/theme';

const GITHUB_URL = 'https://github.com/xujinhuan675-cloud/smart-excalidraw-next';

// 顶部导航项：语义对齐无限画布顶栏，改写为 AnchorRead 的阅读工具入口
export const navigationTools = [
  { slug: 'read', label: '首页', icon: BookOpenText },
  { slug: 'diagram', label: '图解库', icon: Network },
  { slug: 'reader-lab', label: '文档库', icon: Library },
];

const actionIconClass =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4';

// 全局顶栏：所有页面共用，导航项高亮由宿主按当前视图驱动；配置齿轮收纳模型配置、浮动工具栏与术语表三项入口；
// 语言切换与明暗模式切换移植自 infinite-canvas whiteboard 顶栏（UserStatusActions），按钮顺序与 whiteboard 对齐
export default function AppTopNav({ activeSlug = '', onNavigate = () => {}, onConfig = () => {}, onToolbarConfig = () => {}, onGlossary = () => {} }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  // 语言状态集中在 LocaleProvider，切换后全站组件随上下文重渲染
  const { locale, t, setLocale } = useLocale();
  const { theme, setTheme } = useAppTheme();

  const nextLocale = locale === 'zh-CN' ? 'en' : 'zh-CN';
  const languageLabel = t('topNav.switchLanguage', { language: t(nextLocale === 'zh-CN' ? 'locale.zhCN' : 'locale.en') });
  const themeLabel = t(theme === 'dark' ? 'topNav.lightTheme' : 'topNav.darkTheme');

  const switchLocale = () => setLocale(nextLocale);

  return (
    <>
      <header className="z-30 flex h-14 shrink-0 items-stretch border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
        <div className="mx-auto flex h-full w-full max-w-7xl items-stretch justify-between gap-5 px-6">
          <div className="flex min-w-0 items-center">
            <button
              type="button"
              onClick={() => onNavigate('read')}
              className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300"
            >
              <BookOpenText className="size-5 shrink-0" />
              <span className="text-base font-medium">Anchor Read</span>
            </button>

            <button
              type="button"
              className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t('topNav.openNavMenu')}
              title={t('topNav.navMenu')}
            >
              <Menu className="size-5" />
            </button>

            <nav className="scrollbar-hide ml-8 hidden h-14 min-w-0 items-center gap-7 overflow-x-auto md:flex">
              {navigationTools.map((tool) => {
                const Icon = tool.icon;
                const active = tool.slug === activeSlug;
                return (
                  <button
                    key={tool.slug}
                    type="button"
                    onClick={() => onNavigate(tool.slug)}
                    className={
                      active
                        ? 'relative flex h-14 shrink-0 items-center gap-2 text-sm font-medium leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100'
                        : 'relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100'
                    }
                  >
                    <Icon className="size-4" />
                    <span className="truncate">{t(`topNav.${tool.slug}`)}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
            <div className="relative inline-flex shrink-0 items-center gap-1">
              <button
                type="button"
                className={actionIconClass}
                onClick={() => setSettingsOpen((open) => !open)}
                aria-label={t('topNav.config')}
                aria-expanded={settingsOpen}
                title={t('topNav.config')}
              >
                <Settings2 className="size-4" />
              </button>
              {settingsOpen && (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setSettingsOpen(false)} />
                  <div className="absolute right-0 top-9 z-50 w-44 rounded-md border border-stone-200 bg-white p-1.5 shadow-lg dark:border-stone-800 dark:bg-stone-900">
                    <button
                      type="button"
                      onClick={() => { setSettingsOpen(false); onConfig(); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 outline-none hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-white/5"
                    >
                      <Settings2 size={14} className="shrink-0" />
                      {t('topNav.modelConfig')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSettingsOpen(false); setMcpOpen(true); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 outline-none hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-white/5"
                    >
                      <PlugZap size={14} className="shrink-0" />
                      {t('topNav.mcpConnection')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSettingsOpen(false); onToolbarConfig(); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 outline-none hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-white/5"
                    >
                      <WandSparkles size={14} className="shrink-0" />
                      {t('topNav.floatingToolbar')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSettingsOpen(false); onGlossary(); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 outline-none hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-white/5"
                    >
                      <BookMarked size={14} className="shrink-0" />
                      {t('topNav.glossary')}
                    </button>
                  </div>
                </>
              )}
              {/* 语言切换：与 whiteboard 同款形态，按钮显示当前语言（中 / EN），点按切到另一语言 */}
              <button
                type="button"
                className={`${actionIconClass} text-[11px] font-semibold tracking-tight`}
                onClick={switchLocale}
                aria-label={languageLabel}
                title={languageLabel}
              >
                {locale === 'zh-CN' ? '中' : 'EN'}
              </button>
              {/* 明暗模式切换：whiteboard AnimatedThemeToggler 移植版，带 View Transition 圆形揭示动画 */}
              <ThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={actionIconClass}
                aria-label={themeLabel}
                title={themeLabel}
              />
              <span className="shrink-0 cursor-default px-1 text-xs font-medium text-stone-500 dark:text-stone-400" title={t('topNav.version')}>
                v0.1.0
              </span>
              <a
                className={`${actionIconClass} [&_svg]:size-[18px]`}
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
                title="GitHub"
              >
                <svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" aria-hidden="true">
                  <path d="M511.6 76.3C264.3 76.2 64 276.4 64 523.5 64 718.9 189.3 885 363.8 946c23.5 5.9 19.9-10.8 19.9-22.2v-77.5c-135.7 15.9-141.2-73.9-150.3-88.9C215 726 171.5 718 184.5 703c30.9-15.9 62.4 4 98.9 57.9 26.4 39.1 77.9 32.5 104 26 5.7-23.5 17.9-44.5 34.7-60.8-140.6-25.2-199.2-111-199.2-213 0-49.5 16.3-95 48.3-131.7-20.4-60.5 1.9-112.3 4.9-120 58.1-5.2 118.5 41.6 123.2 45.3 33-8.9 70.7-13.6 112.9-13.6 42.4 0 80.2 4.9 113.5 13.9 11.3-8.6 67.3-48.8 121.3-43.9 2.9 7.7 24.7 58.3 5.5 118 32.4 36.8 48.9 82.7 48.9 132.3 0 102.2-59 188.1-200 212.9a127.5 127.5 0 0138.1 91v112.5c.8 9 0 17.9 15 17.9 177.1-59.7 304.6-227 304.6-424.1 0-247.2-200.4-447.3-447.5-447.3z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </header>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute inset-x-0 top-0 border-b border-stone-200 bg-background p-4 dark:border-stone-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{t('topNav.navMenu')}</span>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-md text-stone-600 hover:bg-black/5 dark:text-stone-300 dark:hover:bg-white/10"
                onClick={() => setMobileNavOpen(false)}
                aria-label={t('topNav.closeNavMenu')}
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {navigationTools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.slug}
                    type="button"
                    onClick={() => {
                      setMobileNavOpen(false);
                      onNavigate(tool.slug);
                    }}
                    className="flex items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-stone-700 transition hover:bg-black/5 dark:text-stone-200 dark:hover:bg-white/10"
                  >
                    <Icon className="size-4" />
                    <span>{t(`topNav.${tool.slug}`)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      <McpConnectionPanel
        isOpen={mcpOpen}
        onClose={() => setMcpOpen(false)}
        onOpenDiagrams={() => onNavigate('diagram')}
      />
    </>
  );
}
