'use client';

import { ArrowRight, BookMarked, Layers, LineChart, Network, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import ReaderQuickImport from '@/components/reader-lab/ReaderQuickImport';
import { useLocale } from '@/components/LocaleProvider';

// 全局顶栏点「首页」时广播该事件，首页滚动到导入区
export const GO_IMPORT_EVENT = 'anchor-read:go-import';

// 阅读成果展示卡片：对应原项目「提示词橱窗」，改写成阅读沉淀能力；
// 保留原项目的彩色渐变基因，但透明度调低一档，与全站 stone 基调共存不抢眼
const showcaseItems = [
  {
    icon: Sparkles,
    gradient: 'from-amber-200/40 via-orange-100/40 to-stone-50',
    accent: 'bg-amber-100/80 text-amber-700',
    tagClass: 'bg-amber-100/70 text-amber-700',
  },
  {
    icon: Network,
    gradient: 'from-sky-200/40 via-blue-100/40 to-white',
    accent: 'bg-sky-100/80 text-sky-700',
    tagClass: 'bg-sky-100/70 text-sky-700',
  },
  {
    icon: Layers,
    gradient: 'from-emerald-200/40 via-teal-100/40 to-white',
    accent: 'bg-emerald-100/80 text-emerald-700',
    tagClass: 'bg-emerald-100/70 text-emerald-700',
  },
  {
    icon: BookMarked,
    gradient: 'from-violet-200/40 via-purple-100/40 to-stone-50',
    accent: 'bg-violet-100/80 text-violet-700',
    tagClass: 'bg-violet-100/70 text-violet-700',
  },
  {
    icon: LineChart,
    gradient: 'from-orange-200/40 via-amber-100/40 to-stone-50',
    accent: 'bg-orange-100/80 text-orange-700',
    tagClass: 'bg-orange-100/70 text-orange-700',
  },
];

const showcaseSlugs = ['plain', 'diagram', 'flashcard', 'glossary', 'analytics'];

function Highlighter({ action, color, children }) {
  return (
    <span className="relative inline-block px-1">
      {action === 'highlight' ? (
        <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
      ) : (
        <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
      )}
      <span className="relative font-medium text-stone-800 dark:text-stone-200">{children}</span>
    </span>
  );
}

export default function ReaderHome({
  recentDocuments = [],
  hasExistingDocuments = false,
  busy = false,
  error = '',
  onSubmit,
  onOpenExisting,
  onOpenDocument,
  onOpenDiagram = () => {},
}) {
  const { t } = useLocale();
  const importSectionRef = useRef(null);

  // 「开始使用 / 顶栏首页」都落到导入区：首页的核心动作就是导入一篇文档
  const scrollToImport = () => {
    importSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const handleGoImport = () => scrollToImport();
    window.addEventListener(GO_IMPORT_EVENT, handleGoImport);
    return () => window.removeEventListener(GO_IMPORT_EVENT, handleGoImport);
  }, []);

  return (
    <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
      <section className="relative mx-auto max-w-7xl overflow-hidden px-6">
        <div className="pointer-events-none absolute left-[15%] top-24 size-20 rounded-full border border-dashed border-stone-200 dark:border-stone-800" />
        <div className="pointer-events-none absolute right-[23%] top-[48%] size-20 rounded-full border border-dashed border-stone-200 dark:border-stone-800" />

        <div className="relative flex min-h-[480px] flex-col items-center justify-center pt-10 text-center">
          <h1 className="ai-title-aurora max-w-5xl text-balance text-5xl font-semibold tracking-normal sm:text-7xl lg:text-8xl">Anchor Read</h1>
          <p className="mt-8 max-w-3xl text-balance text-lg leading-8 text-stone-500 dark:text-stone-400">
            {t('home.heroLeadPre')}<Highlighter action="underline" color="#FF9800">Anchor Read</Highlighter>
            {t('home.heroLeadMid')}<Highlighter action="highlight" color="#87CEFA">{t('home.heroLeadKnowledge')}</Highlighter>
            {t('home.heroLeadPost')}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={scrollToImport}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-stone-950 px-6 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
            >
              <span>{t('home.getStart')}</span>
              <ArrowRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={onOpenDiagram}
              className="inline-flex h-11 items-center rounded-lg border border-stone-300 bg-white px-6 text-sm font-medium text-stone-950 transition hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:bg-transparent dark:text-stone-100 dark:hover:bg-white/10"
            >
              {t('home.openDiagram')}
            </button>
          </div>
        </div>

        {/* 快速导入区：结构对齐展示区的「标题 + 描述」居中头，文档库入口收在最近文档区 */}
        <section ref={importSectionRef} className="relative mx-auto mb-16 max-w-6xl scroll-mt-6 border-t border-stone-200 pt-12 dark:border-stone-800">
          <div className="mb-8 max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-semibold text-stone-950 dark:text-stone-100">{t('home.quickImportHeading')}</h2>
            <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">
              {t('home.quickImportSub')}
            </p>
          </div>

          <ReaderQuickImport
            recentDocuments={recentDocuments}
            hasExistingDocuments={hasExistingDocuments}
            busy={busy}
            error={error}
            onSubmit={onSubmit}
            onOpenExisting={onOpenExisting}
            onOpenDocument={onOpenDocument}
          />
        </section>

        {/* 阅读成果展示：对应原项目「沉淀每一次好结果」橱窗 */}
        <section className="relative mx-auto mb-20 max-w-6xl border-t border-stone-200 pt-12 dark:border-stone-800">
          <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
            <div />
            <div className="max-w-2xl text-center">
              <h2 className="text-3xl font-semibold text-stone-950 dark:text-stone-100">{t('home.showcaseHeading')}</h2>
              <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">
                {t('home.showcaseSub')}
              </p>
            </div>
            <button
              type="button"
              onClick={scrollToImport}
              className="inline-flex items-center gap-1.5 justify-self-center text-sm font-medium text-stone-950 transition hover:text-stone-600 md:justify-self-end dark:text-stone-100 dark:hover:text-stone-300"
            >
              <span>{t('home.startReading')}</span>
              <ArrowRight className="size-4" />
            </button>
          </div>
          {/* 上下两行的 3+2 结构：首行闪卡+白话(2格)+图解，次行术语(2格)+分析(2格)，
              靠自动排布恰好填满 4 列；卡片按内容压缩高度，文案顶部对齐不留白 */}
          <div className="grid auto-rows-[180px] gap-4 md:grid-cols-4">
            {showcaseItems.map((item, index) => {
              const Icon = item.icon;
              const slug = showcaseSlugs[index];
              // DOM 顺序保持语义；白话占首行两格，术语/分析各占次行两格
              const gridPlace = [
                'md:col-span-2',
                '',
                '',
                'md:col-span-2',
                'md:col-span-2',
              ][index];
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => (index === 1 ? onOpenDiagram() : scrollToImport())}
                  className={[
                    'group relative cursor-pointer overflow-hidden border border-stone-200 text-left transition hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600',
                    `bg-gradient-to-br ${item.gradient}`,
                    gridPlace,
                  ].join(' ')}
                >
                  <div className="flex h-full flex-col p-4 text-center">
                    <div className="mb-2 flex w-full items-center justify-between">
                      <span className={`inline-flex size-10 items-center justify-center rounded-full shadow-sm backdrop-blur transition duration-500 group-hover:scale-110 dark:bg-white/10 dark:text-stone-200 ${item.accent}`}>
                        <Icon className="size-5" />
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium backdrop-blur dark:bg-white/10 dark:text-stone-300 ${item.tagClass}`}>
                        {t(`home.showcase.${slug}.tag`)}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{t(`home.showcase.${slug}.title`)}</h3>
                      <p className="mt-1.5 text-sm leading-6 text-stone-600 dark:text-stone-300">{t(`home.showcase.${slug}.desc`)}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
