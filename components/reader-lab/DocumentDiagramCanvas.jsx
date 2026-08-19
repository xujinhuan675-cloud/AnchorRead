'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { FileCode2, PanelRightOpen } from 'lucide-react';
import CodeEditor from '@/components/CodeEditor';
import MermaidCanvas from '@/components/MermaidCanvas';
import { useLocale } from '@/components/LocaleProvider';

const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), { ssr: false });

// 左侧主区域：图表画布 + 生成代码编辑区，与右侧对话区共享同一份 diagram 状态
// 源码编辑区默认收起：mermaid 下源码开关提到画布头部放大按钮右侧，
// excalidraw 没有头部，仍悬浮在画布右下角；内联卡片传入 showCode 时按外部控制为准
export default function DocumentDiagramCanvas({ diagram, showCode, standalone = false, onOpenChat = null }) {
  const { t } = useLocale();
  const [codeOpen, setCodeOpen] = useState(false);
  const isCodeVisible = typeof showCode === 'boolean' ? showCode : codeOpen;
  const {
    engine,
    code,
    elements,
    error,
    setError,
    isGenerating,
    isApplyingCode,
    isOptimizingCode,
    handleApply,
    handleOptimize,
    changeCode,
    clearCode,
    changeElements,
  } = diagram;

  // 源码开关：自管模式下才可切换，样式随宿主位置（头部图标位 / 悬浮文字钮）而变
  const canToggleCode = typeof showCode !== 'boolean';
  const sourceCodeButton = (variant) => (
    <button
      type="button"
      onClick={() => setCodeOpen((open) => !open)}
      aria-pressed={codeOpen}
      title={codeOpen ? t('diagram.collapseSource') : t('diagram.expandSource')}
      className={variant === 'header'
        ? `flex h-8 w-8 shrink-0 items-center justify-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-stone-400 ${codeOpen ? 'text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400 hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-white/10 dark:hover:text-stone-100'}`
        : `absolute bottom-3 right-3 z-10 flex h-7 items-center gap-1.5 rounded border px-2.5 text-xs font-medium shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-stone-950 dark:focus-visible:ring-stone-100 ${codeOpen ? 'border-stone-300 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100' : 'border-stone-200 bg-white text-stone-600 hover:text-stone-900 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
    >
      <FileCode2 size={variant === 'header' ? 15 : 13} aria-hidden="true" />
      {variant !== 'header' && (codeOpen ? t('diagram.collapseSource') : t('diagram.source'))}
    </button>
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-stone-50 dark:bg-white/5" aria-label={t('diagram.canvasAria')}>
      <div className={`relative min-h-0 bg-stone-50 dark:bg-white/5 ${isCodeVisible ? 'flex-[3]' : 'flex-1'}`}>
        {engine === 'mermaid'
          ? (
            <MermaidCanvas
              source={code}
              title={standalone ? t('diagram.freeTitle') : t('diagram.docTitle')}
              subtitle={standalone ? t('diagram.freeSubtitle') : null}
              emptyMessage={standalone ? t('diagram.freeEmpty') : undefined}
              headerActions={(canToggleCode || onOpenChat) ? (
                <>
                  {canToggleCode ? sourceCodeButton('header') : null}
                  {onOpenChat && (
                    // 窄屏抽屉形态的对话入口：放到源码按钮右侧，图标与文档库展开按钮同族
                    <button
                      type="button"
                      onClick={onOpenChat}
                      aria-label={t('diagram.openChat')}
                      title={t('diagram.openChat')}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-stone-600 outline-none transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 lg:hidden dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-100"
                    >
                      <PanelRightOpen size={16} aria-hidden="true" />
                    </button>
                  )}
                </>
              ) : null}
            />
          )
          : <ExcalidrawCanvas elements={elements} onElementsChange={changeElements} />}
        {/* excalidraw 画布没有头部：源码开关仍悬浮在右下角，避开其自带的顶部按钮 */}
        {engine !== 'mermaid' && canToggleCode && sourceCodeButton('float')}
      </div>
      {isCodeVisible && (
        <div className="min-h-0 flex-[2] border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
          <CodeEditor
            code={code}
            onChange={changeCode}
            onApply={handleApply}
            onOptimize={handleOptimize}
            onClear={clearCode}
            jsonError={error}
            onClearJsonError={() => setError('')}
            isGenerating={isGenerating}
            isApplyingCode={isApplyingCode}
            isOptimizingCode={isOptimizingCode}
            engine={engine}
          />
        </div>
      )}
    </section>
  );
}
