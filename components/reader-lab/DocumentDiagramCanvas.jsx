'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Download, FileCode2, History, PanelRightOpen, Upload } from 'lucide-react';
import CodeEditor from '@/components/CodeEditor';
import MermaidCanvas from '@/components/MermaidCanvas';
import { useLocale } from '@/components/LocaleProvider';
import {
  parseExcalidrawScene,
  serializeExcalidrawScene,
} from '@/lib/excalidraw-scene';

const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), { ssr: false });

// 左侧主区域：图表画布 + 生成代码编辑区，与右侧对话区共享同一份 diagram 状态
// 源码编辑区默认收起：mermaid 下源码开关提到画布头部放大按钮右侧，
// excalidraw 没有头部，仍悬浮在画布右下角；内联卡片传入 showCode 时按外部控制为准
export default function DocumentDiagramCanvas({ diagram, showCode, standalone = false, onOpenChat = null }) {
  const { t } = useLocale();
  const [codeOpen, setCodeOpen] = useState(false);
  const [selectedRevision, setSelectedRevision] = useState('');
  const fileInputRef = useRef(null);
  const isCodeVisible = typeof showCode === 'boolean' ? showCode : codeOpen;
  const {
    engine,
    code,
    elements,
    appState,
    files,
    revision,
    revisionHistory,
    error,
    setError,
    isGenerating,
    isApplyingCode,
    isOptimizingCode,
    handleApply,
    handleOptimize,
    changeCode,
    clearCode,
    changeScene,
    restoreRevision,
  } = diagram;

  const exportExcalidraw = () => {
    const scene = serializeExcalidrawScene({ elements, appState, files });
    const blob = new Blob([scene], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${standalone ? 'anchor-read-freeform' : 'anchor-read-diagram'}.excalidraw`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importExcalidraw = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      changeScene(parseExcalidrawScene(await file.text()));
    } catch (caughtError) {
      setError(caughtError.message || t('diagram.importFailed'));
    }
  };

  // 源码开关：自管模式下才可切换，样式随宿主位置（头部图标位 / 悬浮文字钮）而变
  const canToggleCode = typeof showCode !== 'boolean';
  const sourceCodeButton = (variant) => (
    <button
      type="button"
      onClick={() => setCodeOpen((open) => !open)}
      aria-label={codeOpen ? t('diagram.collapseSource') : t('diagram.expandSource')}
      aria-pressed={codeOpen}
      title={codeOpen ? t('diagram.collapseSource') : t('diagram.expandSource')}
      className={variant === 'header'
        ? `flex h-8 w-8 shrink-0 items-center justify-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-stone-400 ${codeOpen ? 'text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400 hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-white/10 dark:hover:text-stone-100'}`
        : `absolute bottom-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-stone-950 dark:focus-visible:ring-stone-100 ${codeOpen ? 'border-stone-300 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100' : 'border-stone-200 bg-white text-stone-600 hover:text-stone-900 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
    >
      <FileCode2 size={15} aria-hidden="true" />
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
          : <ExcalidrawCanvas
            elements={elements}
            appState={appState}
            files={files}
            onSceneChange={changeScene}
          />}
        {engine === 'excalidraw' && (
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-md border border-stone-200 bg-white/95 p-0.5 shadow-sm backdrop-blur dark:border-stone-700 dark:bg-stone-900/95">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t('diagram.importExcalidraw')}
              title={t('diagram.importExcalidraw')}
              className="flex h-8 w-8 items-center justify-center rounded text-stone-600 outline-none transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <Upload size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={exportExcalidraw}
              aria-label={t('diagram.exportExcalidraw')}
              title={t('diagram.exportExcalidraw')}
              className="flex h-8 w-8 items-center justify-center rounded text-stone-600 outline-none transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <Download size={15} aria-hidden="true" />
            </button>
            {revisionHistory?.length > 0 && (
              <>
                <select
                  value={selectedRevision}
                  onChange={(event) => setSelectedRevision(event.target.value)}
                  aria-label={t('diagram.revisionSelect')}
                  title={t('diagram.revisionSelect')}
                  className="h-8 max-w-40 rounded px-1 text-[11px] text-stone-600 outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:bg-stone-900 dark:text-stone-300"
                >
                  <option value="">v{revision || 0}</option>
                  {[...revisionHistory].reverse().map((item) => (
                    <option key={item.id} value={item.id}>
                      v{item.revision} · {item.reason}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedRevision) return;
                    restoreRevision(selectedRevision);
                    setSelectedRevision('');
                  }}
                  disabled={!selectedRevision}
                  aria-label={t('diagram.restoreRevision')}
                  title={t('diagram.restoreRevision')}
                  className="flex h-8 w-8 items-center justify-center rounded text-stone-600 outline-none transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <History size={15} aria-hidden="true" />
                </button>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".excalidraw,application/json"
              className="hidden"
              onChange={importExcalidraw}
            />
          </div>
        )}
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
