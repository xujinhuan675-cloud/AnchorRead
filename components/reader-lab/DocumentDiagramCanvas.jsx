'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { FileCode2, Pause, Play, PanelRightClose, PanelRightOpen, SkipBack, SkipForward, Square } from 'lucide-react';
import CodeEditor from '@/components/CodeEditor';
import MermaidCanvas from '@/components/MermaidCanvas';
import { useLocale } from '@/components/LocaleProvider';
import { DIAGRAM_AGENT_PENDING_PRESENTATION_KEY, DIAGRAM_AGENT_PRESENTATION_EVENT } from '@/components/DiagramAgentBridge';
import { getPresentationStepPlaybackDuration, normalizePresentationSpec, PRESENTATION_PLAYBACK_RATES } from '@/lib/diagram-presentation';
import { createDefaultMermaidPresentation, createDefaultPresentation, isDefaultMermaidPresentation, reconcilePresentationSpec } from '@/lib/diagram-stream';
import CanvasToolbar from '@/components/CanvasToolbar';
import CanvasToolbarButton from '@/components/CanvasToolbarButton';

const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), { ssr: false });

// 左侧主区域：图表画布 + 生成代码编辑区，与右侧对话区共享同一份 diagram 状态
// 源码编辑区默认收起：两种画布都把源码入口放进左上角主菜单；
// 内联卡片传入 showCode 时按外部控制为准
export default function DocumentDiagramCanvas({ diagram, showCode, standalone = false, onOpenChat = null, onCloseChat = null }) {
  const { t } = useLocale();
  const [codeOpen, setCodeOpen] = useState(false);
  const [presentationActive, setPresentationActive] = useState(false);
  const [presentationPlaying, setPresentationPlaying] = useState(false);
  const [presentationStepIndex, setPresentationStepIndex] = useState(0);
  const [presentationPlaybackRate, setPresentationPlaybackRate] = useState(1);
  const fileInputRef = useRef(null);
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
    importExcalidrawScene,
    presentation: rawPresentation,
    presentationDisabled,
    streamElements,
  } = diagram;
  const presentation = useMemo(() => {
    // 生成后再增删改元素时，播放脚本与当前画布对账后再归一：
    // 新增元素进收尾步、整体替换则重建流式重放，避免播放空白/漏显
    try {
      const reconciled = normalizePresentationSpec(reconcilePresentationSpec(rawPresentation, elements));
      if (!presentationDisabled && engine === 'mermaid' && (!reconciled || isDefaultMermaidPresentation(reconciled))) {
        return normalizePresentationSpec(createDefaultMermaidPresentation(code));
      }
      if (reconciled || presentationDisabled) {
        return reconciled;
      }
      return normalizePresentationSpec(engine === 'excalidraw'
        ? createDefaultPresentation(elements)
        : createDefaultMermaidPresentation(code));
    } catch { return null; }
  }, [code, engine, presentationDisabled, rawPresentation, elements]);
  const effectivePresentationActive = presentationActive && Boolean(presentation);
  const effectivePresentationPlaying = presentationPlaying && effectivePresentationActive;
  const effectivePresentationStepIndex = presentation
    ? Math.min(presentationStepIndex, presentation.steps.length - 1)
    : 0;
  const presentationStep = presentation?.steps?.[effectivePresentationStepIndex] || null;
  const presentationHasNamedSteps = presentation?.steps?.some((step) => Boolean(step.title));
  const toggleCode = useCallback(() => setCodeOpen((open) => !open), []);

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
      else if (detail.action === 'next') { setPresentationActive(true); setPresentationPlaying(false); setPresentationStepIndex((index) => Math.min(presentation.steps.length - 1, index + 1)); }
      else if (detail.action === 'previous') { setPresentationActive(true); setPresentationPlaying(false); setPresentationStepIndex((index) => Math.max(0, index - 1)); }
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
    }, getPresentationStepPlaybackDuration(presentationStep, presentationPlaybackRate));
    return () => window.clearTimeout(timer);
  }, [effectivePresentationPlaying, effectivePresentationStepIndex, presentationStep, presentation, presentationPlaybackRate]);

  const openImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImport = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await importExcalidrawScene(await file.text());
    } catch (caughtError) {
      setError(caughtError.message || t('diagram.importFailed'));
    }
  }, [importExcalidrawScene, setError, t]);

  // 源码开关：自管模式下才可切换；Excalidraw 交给原生主菜单
  const canToggleCode = typeof showCode !== 'boolean';
  const sourceMenuItems = canToggleCode ? [{
    id: 'toggle-source-code',
    icon: <FileCode2 size={18} />,
    label: codeOpen ? t('diagram.collapseSource') : t('diagram.expandSource'),
    selected: codeOpen,
    onSelect: toggleCode,
  }] : [];

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
              presentationStep={presentationStep}
              presentationActive={effectivePresentationActive}
              presentationStepIndex={effectivePresentationStepIndex}
              presentationStepCount={presentation?.steps.length || 0}
              mainMenuItems={sourceMenuItems}
              mainMenuOpenLabel={t('diagram.openCanvasMenu')}
              mainMenuCloseLabel={t('diagram.closeCanvasMenu')}
              // Mermaid 和 Excalidraw 都把源码开关放进左侧菜单；右上角只保留面板切换
              headerActions={(onOpenChat || onCloseChat) ? (
                <>
                  {onOpenChat && (
                    // 收起面板/打开抽屉入口：与右侧 PanelRightClose 对称
                    <CanvasToolbarButton
                      onClick={onOpenChat}
                      aria-label={t('diagram.openChat')}
                      title={t('diagram.openChat')}
                    >
                      <PanelRightOpen size={16} className="size-4" aria-hidden="true" />
                    </CanvasToolbarButton>
                  )}
                  {onCloseChat && (
                    // 展开面板/关闭抽屉入口：与 PanelRightOpen 对称
                    <CanvasToolbarButton
                      onClick={onCloseChat}
                      aria-label={t('workspace.collapseRightPanel')}
                      title={t('workspace.collapseRightPanel')}
                    >
                      <PanelRightClose size={16} className="size-4" aria-hidden="true" />
                    </CanvasToolbarButton>
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
            onToggleSourceCode={canToggleCode ? toggleCode : null}
            sourceCodeOpen={isCodeVisible}
            sourceExpandLabel={t('diagram.expandSource')}
            sourceCollapseLabel={t('diagram.collapseSource')}
            onImport={canToggleCode ? openImport : null}
            importLabel={t('common.import')}
          />}
        <input
          ref={fileInputRef}
          type="file"
          accept=".excalidraw,application/json"
          className="hidden"
          onChange={handleImport}
        />
        {presentation && (
          /* 播放条靠右下角：左下角是 Excalidraw 原生缩放控件的位置，避免与其重叠；
             源码开关已收进主菜单，右下角只剩播放条 */
          <CanvasToolbar floating className="absolute bottom-4 right-4 z-10 max-w-[calc(100%-2rem)]">
            <CanvasToolbarButton
              onClick={() => {
                setPresentationActive(true);
                setPresentationPlaying((playing) => !playing);
              }}
              aria-label={effectivePresentationPlaying ? t('diagram.presentation.pause') : t('diagram.presentation.play')}
              title={effectivePresentationPlaying ? t('diagram.presentation.pause') : t('diagram.presentation.play')}
            >
              {effectivePresentationPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            </CanvasToolbarButton>
            <CanvasToolbarButton onClick={() => { setPresentationActive(true); setPresentationPlaying(false); setPresentationStepIndex((index) => Math.max(0, index - 1)); }} aria-label={t('diagram.presentation.previous')} title={t('diagram.presentation.previous')}><SkipBack size={15} aria-hidden="true" /></CanvasToolbarButton>
            {presentationHasNamedSteps && (
              <select
                value={effectivePresentationStepIndex}
                aria-label={t('diagram.presentation.selectStep')}
                className="w-24 max-w-[12rem] min-w-0 bg-transparent px-1 text-xs outline-none sm:w-auto"
                onChange={(event) => {
                  setPresentationActive(true);
                  setPresentationPlaying(false);
                  setPresentationStepIndex(Number(event.target.value));
                }}
              >
                {presentation.steps.map((step, index) => (
                  <option key={step.id} value={index}>
                    {step.title || t('diagram.presentation.unnamedStep', { number: index + 1 })}
                  </option>
                ))}
              </select>
            )}
            <select
              value={presentationPlaybackRate}
              aria-label={t('diagram.presentation.speed')}
              title={t('diagram.presentation.speed')}
              className="w-14 shrink-0 bg-transparent px-1 text-xs tabular-nums outline-none"
              onChange={(event) => setPresentationPlaybackRate(Number(event.target.value))}
            >
              {PRESENTATION_PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
            </select>
            <span className="min-w-6 px-1 text-center text-[14px] tabular-nums" aria-live="polite">{presentationStepIndex + 1}/{presentation.steps.length}</span>
            <CanvasToolbarButton onClick={() => { setPresentationActive(true); setPresentationPlaying(false); setPresentationStepIndex((index) => Math.min(presentation.steps.length - 1, index + 1)); }} aria-label={t('diagram.presentation.next')} title={t('diagram.presentation.next')}><SkipForward size={15} aria-hidden="true" /></CanvasToolbarButton>
            {effectivePresentationActive && <CanvasToolbarButton onClick={() => { setPresentationActive(false); setPresentationPlaying(false); setPresentationStepIndex(0); }} aria-label={t('diagram.presentation.stop')} title={t('diagram.presentation.stop')}><Square size={14} aria-hidden="true" /></CanvasToolbarButton>}
          </CanvasToolbar>
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
