'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { FileCode2, Pause, Play, PanelRightClose, PanelRightOpen, SkipBack, SkipForward, Square } from 'lucide-react';
import CodeEditor from '@/components/CodeEditor';
import MermaidCanvas from '@/components/MermaidCanvas';
import { useLocale } from '@/components/LocaleProvider';
import { DIAGRAM_AGENT_PENDING_PRESENTATION_KEY, DIAGRAM_AGENT_PRESENTATION_EVENT } from '@/components/DiagramAgentBridge';
import { normalizePresentationSpec } from '@/lib/diagram-presentation';
import { reconcilePresentationSpec } from '@/lib/diagram-stream';
import { useAppTheme } from '@/lib/theme';
import './diagram-overlay.css';

const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), { ssr: false });

// 左侧主区域：图表画布 + 生成代码编辑区，与右侧对话区共享同一份 diagram 状态
// 源码编辑区默认收起：mermaid 下源码开关在画布头部放大按钮右侧；
// excalidraw 下收进画布左上角主菜单作为选项；内联卡片传入 showCode 时按外部控制为准
export default function DocumentDiagramCanvas({ diagram, showCode, standalone = false, onOpenChat = null, onCloseChat = null }) {
  const { t } = useLocale();
  // 悬浮控件的 Excalidraw 原生风格由 diagram-overlay.css 的 ar-overlay-* 类承担
  // （透明底 / hover 官方淡紫，色值摘自 0.18 主题）；暗色只需在容器上挂 theme--dark，
  // 不能再挂 .excalidraw 类，它自带的画布容器布局规则会撑坏按钮定位
  const { theme: appTheme } = useAppTheme();
  const excalidrawThemeClass = appTheme === 'dark' ? ' theme--dark' : '';
  const [codeOpen, setCodeOpen] = useState(false);
  const [presentationActive, setPresentationActive] = useState(false);
  const [presentationPlaying, setPresentationPlaying] = useState(false);
  const [presentationStepIndex, setPresentationStepIndex] = useState(0);
  const isCodeVisible = typeof showCode === 'boolean' ? showCode : codeOpen;
  const {
    engine,
    code,
    elements,
    appState,
    files,
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
    presentation: rawPresentation,
    streamElements,
  } = diagram;
  const presentation = useMemo(() => {
    // 生成后再增删改元素时，播放脚本与当前画布对账后再归一：
    // 新增元素进收尾步、整体替换则重建流式重放，避免播放空白/漏显
    try { return normalizePresentationSpec(reconcilePresentationSpec(rawPresentation, elements)); } catch { return null; }
  }, [rawPresentation, elements]);
  const effectivePresentationActive = presentationActive && Boolean(presentation);
  const effectivePresentationPlaying = presentationPlaying && effectivePresentationActive;
  const effectivePresentationStepIndex = presentation
    ? Math.min(presentationStepIndex, presentation.steps.length - 1)
    : 0;
  const presentationStep = presentation?.steps?.[effectivePresentationStepIndex] || null;

  useEffect(() => {
    const handlePresentation = (event) => {
      const detail = event.detail || {};
      if (detail.drawingId && diagram?.drawingId && detail.drawingId !== diagram.drawingId) return;
      if (!presentation) return;
      window.sessionStorage.removeItem(DIAGRAM_AGENT_PENDING_PRESENTATION_KEY);
      if (detail.action === 'play') {
        setPresentationStepIndex(Number.isInteger(detail.stepIndex) ? Math.max(0, Math.min(presentation.steps.length - 1, detail.stepIndex)) : 0);
        setPresentationActive(true);
        setPresentationPlaying(true);
      } else if (detail.action === 'pause') setPresentationPlaying(false);
      else if (detail.action === 'stop') { setPresentationActive(false); setPresentationPlaying(false); setPresentationStepIndex(0); }
      else if (detail.action === 'next') { setPresentationActive(true); setPresentationStepIndex((index) => Math.min(presentation.steps.length - 1, index + 1)); }
      else if (detail.action === 'previous') { setPresentationActive(true); setPresentationStepIndex((index) => Math.max(0, index - 1)); }
    };
    window.addEventListener(DIAGRAM_AGENT_PRESENTATION_EVENT, handlePresentation);
    try {
      const pending = JSON.parse(window.sessionStorage.getItem(DIAGRAM_AGENT_PENDING_PRESENTATION_KEY) || 'null');
      if (pending) handlePresentation({ detail: pending });
    } catch {
      window.sessionStorage.removeItem(DIAGRAM_AGENT_PENDING_PRESENTATION_KEY);
    }
    return () => window.removeEventListener(DIAGRAM_AGENT_PRESENTATION_EVENT, handlePresentation);
  }, [diagram?.drawingId, presentation]);

  useEffect(() => {
    if (!effectivePresentationPlaying || !presentationStep) return undefined;
    const timer = window.setTimeout(() => {
      // 用闭包里的当前步索引直接判定收尾：不在 setState updater 里嵌套
      // 另一个 setState（impure updater 在 dev 双调用下会触发嵌套更新越界）
      if (effectivePresentationStepIndex >= (presentation?.steps?.length || 1) - 1) {
        setPresentationPlaying(false);
      } else {
        setPresentationStepIndex(effectivePresentationStepIndex + 1);
      }
    }, presentationStep.durationMs);
    return () => window.clearTimeout(timer);
  }, [effectivePresentationPlaying, effectivePresentationStepIndex, presentationStep, presentation]);

  // 源码开关：自管模式下才可切换；mermaid 挂在画布头部，excalidraw 收进主菜单
  const canToggleCode = typeof showCode !== 'boolean';
  const sourceCodeButton = (
    <button
      type="button"
      onClick={() => setCodeOpen((open) => !open)}
      aria-label={codeOpen ? t('diagram.collapseSource') : t('diagram.expandSource')}
      aria-pressed={codeOpen}
      title={codeOpen ? t('diagram.collapseSource') : t('diagram.expandSource')}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-stone-400 ${codeOpen ? 'text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400 hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-white/10 dark:hover:text-stone-100'}`}
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
              headerActions={(canToggleCode || onOpenChat || onCloseChat) ? (
                <>
                  {canToggleCode ? sourceCodeButton : null}
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
                  {onCloseChat && (
                    // 与展开入口同槽位对称：窄屏打开 Sheet 后由此收起
                    <button
                      type="button"
                      onClick={onCloseChat}
                      aria-label={t('workspace.collapseRightPanel')}
                      title={t('workspace.collapseRightPanel')}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-stone-600 outline-none transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 lg:hidden dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-100"
                    >
                      <PanelRightClose size={16} aria-hidden="true" />
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
            presentationStep={presentationStep}
            presentationActive={effectivePresentationActive}
            streamElements={streamElements}
            onExpandPanel={onOpenChat}
            expandPanelTitle={t('diagram.openChat')}
            onCollapsePanel={onCloseChat}
            collapsePanelTitle={t('workspace.collapseRightPanel')}
            onToggleSourceCode={canToggleCode ? () => setCodeOpen((open) => !open) : null}
            sourceCodeOpen={isCodeVisible}
            sourceExpandLabel={t('diagram.expandSource')}
            sourceCollapseLabel={t('diagram.collapseSource')}
          />}
        {engine === 'excalidraw' && presentation && (
          /* 播放条靠右下角：左下角是 Excalidraw 原生缩放控件的位置，避免与其重叠；
             源码开关已收进主菜单，右下角只剩播放条 */
          <div className={`ar-overlay-island${excalidrawThemeClass} absolute bottom-3 right-3 z-10 flex items-center gap-1 p-0.5`}>
            <button
              type="button"
              onClick={() => {
                setPresentationActive(true);
                setPresentationPlaying((playing) => !playing);
              }}
              aria-label={effectivePresentationPlaying ? t('diagram.presentation.pause') : t('diagram.presentation.play')}
              title={effectivePresentationPlaying ? t('diagram.presentation.pause') : t('diagram.presentation.play')}
              className="ar-overlay-tool flex h-8 w-8 items-center justify-center rounded outline-none"
            >
              {effectivePresentationPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => { setPresentationActive(true); setPresentationPlaying(true); setPresentationStepIndex((index) => Math.max(0, index - 1)); }} aria-label={t('diagram.presentation.previous')} title={t('diagram.presentation.previous')} className="ar-overlay-tool flex h-8 w-8 items-center justify-center rounded outline-none"><SkipBack size={15} aria-hidden="true" /></button>
            {/* 步数夹在左右步进键中间：播放器惯例，点步进键时视线不用移动；
                字号与左下角 Excalidraw 原生缩放百分比（14px）保持一致 */}
            <span className="min-w-6 px-1 text-center text-[14px] tabular-nums" aria-live="polite">{presentationStepIndex + 1}/{presentation.steps.length}</span>
            <button type="button" onClick={() => { setPresentationActive(true); setPresentationPlaying(true); setPresentationStepIndex((index) => Math.min(presentation.steps.length - 1, index + 1)); }} aria-label={t('diagram.presentation.next')} title={t('diagram.presentation.next')} className="ar-overlay-tool flex h-8 w-8 items-center justify-center rounded outline-none"><SkipForward size={15} aria-hidden="true" /></button>
            {effectivePresentationActive && <button type="button" onClick={() => { setPresentationActive(false); setPresentationPlaying(false); setPresentationStepIndex(0); }} aria-label={t('diagram.presentation.stop')} title={t('diagram.presentation.stop')} className="ar-overlay-tool flex h-8 w-8 items-center justify-center rounded outline-none"><Square size={14} aria-hidden="true" /></button>}
          </div>
        )}
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
