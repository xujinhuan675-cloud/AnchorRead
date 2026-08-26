'use client';

import { Check, ChevronDown, Crosshair, History, LoaderCircle, PanelRightClose, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Chat from '@/components/Chat';
import { useLocale } from '@/components/LocaleProvider';
import { createDocumentDrawingId } from '@/lib/diagram-generation';
import { CHART_TYPES } from '@/lib/constants';

// 右侧对话区：只保留图表对话与图表管理，画布与代码区在左侧主区域渲染
export default function DocumentDiagramPanel({
  document,
  standalone = false,
  drawings,
  activeDrawing,
  onSelectDrawing,
  onCreateDrawing,
  onOpenHistory,
  onToggleSidebar = null,
  onRenameDrawing = () => {},
  anchor = null,
  onClearAnchor,
  diagram,
}) {
  const { engine, chartType, setChartType, isGenerating, generate, handleEngineChange } = diagram;
  const { t } = useLocale();
  // 输入模式由面板持有：tabs 提到头部控制子栏，Chat 走受控模式
  const [inputTab, setInputTab] = useState('text');
  // 图解切换改为自定义下拉（外框表明可点）；双击名称进入重命名输入态
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  // 单击延迟开菜单、双击取消它：避免双击重命名时被中间的单击干扰，让双击稳定可触发
  const selectClickTimer = useRef(null);
  useEffect(() => () => clearTimeout(selectClickTimer.current), []);
  const handleSelectClick = (event) => {
    if (event.detail > 1) return;
    clearTimeout(selectClickTimer.current);
    selectClickTimer.current = setTimeout(() => setMenuOpen((open) => !open), 200);
  };
  const handleSelectDoubleClick = () => {
    clearTimeout(selectClickTimer.current);
    setMenuOpen(false);
    setDraftTitle(activeDrawing?.title || '');
    setRenaming(true);
  };

  const commitRename = () => {
    const title = draftTitle.trim();
    if (activeDrawing && title && title !== activeDrawing.title) onRenameDrawing(activeDrawing.id, title);
    setRenaming(false);
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-white dark:bg-stone-900" aria-label={standalone ? t('diagram.chatAria.free') : t('diagram.chatAria.doc')}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 dark:border-stone-800 bg-white py-2.5 pl-3 pr-12 lg:pr-3 dark:bg-stone-900">
        {/* 图解选择器直接替代面板标题：外框表明是下拉，双击名称重命名；删除、新建、历史同一行 */}
        {renaming && activeDrawing ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename();
              else if (event.key === 'Escape') setRenaming(false);
            }}
            aria-label={t('diagram.renameAria')}
            className="h-8 min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 text-sm font-semibold text-stone-900 outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-700 dark:bg-white/5 dark:text-stone-100"
          />
        ) : (
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={handleSelectClick}
              onDoubleClick={handleSelectDoubleClick}
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-label={t('diagram.selectAria')}
              title={t('diagram.selectHint')}
              className="flex h-8 w-full items-center gap-1 rounded border border-stone-200 bg-white px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-800 dark:bg-white/5"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{activeDrawing?.title || t('diagram.untitled')}</span>
              <ChevronDown size={12} className="shrink-0 text-stone-400" aria-hidden="true" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
                <ul role="listbox" aria-label={t('diagram.listAria')} className="absolute left-0 top-8 z-50 max-h-56 w-full min-w-36 overflow-auto rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-800 dark:bg-stone-900">
                  {drawings.length === 0
                    ? <li className="px-2 py-1.5 text-xs text-stone-400">{t('diagram.listEmpty')}</li>
                    : drawings.map((drawing) => (
                      <li key={drawing.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={drawing.id === activeDrawing?.id}
                          onClick={() => { onSelectDrawing(drawing.id); setMenuOpen(false); }}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-stone-700 outline-none hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-white/5"
                        >
                          <span className="min-w-0 flex-1 truncate">{drawing.title || drawing.id}</span>
                          {drawing.id === activeDrawing?.id ? <Check size={12} className="shrink-0 text-stone-500" aria-hidden="true" /> : null}
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>
        )}
        {isGenerating ? <LoaderCircle size={13} className="shrink-0 animate-spin text-stone-400" aria-hidden="true" /> : null}
        <button type="button" onClick={() => onCreateDrawing({ id: createDocumentDrawingId(document.id), documentId: document.id, title: t('diagram.untitled'), engine: 'mermaid', chartType: 'auto', source: '', createdAt: Date.now(), updatedAt: Date.now() })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-stone-500 outline-none hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 dark:text-stone-400 dark:hover:text-stone-100" title={t('diagram.create')} aria-label={t('diagram.create')}><Plus size={15} /></button>
        <button type="button" onClick={onOpenHistory} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-stone-500 outline-none hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 dark:text-stone-400 dark:hover:text-stone-100" title={t('diagram.openHistory')} aria-label={t('diagram.openHistory')}><History size={15} /></button>
        {onToggleSidebar ? <button type="button" onClick={onToggleSidebar} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-stone-500 outline-none hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 dark:text-stone-400 dark:hover:text-stone-100" title={t('workspace.collapseRightPanel')} aria-label={t('workspace.collapseRightPanel')}><PanelRightClose size={15} /></button> : null}
      </header>
      {/* 控制子栏：输入模式、引擎与图类型集中收纳在头部，Chat 内容区只留输入本身 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50 px-3 py-1.5 dark:border-stone-800 dark:bg-white/5">
        <div className="flex rounded border border-stone-200 bg-white p-0.5 dark:border-stone-800 dark:bg-white/5" role="group" aria-label={t('diagram.inputModeAria')}>
          {[
            ['text', t('diagram.input.text')],
            ['file', t('diagram.input.file')],
            ['image', t('diagram.input.image')],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setInputTab(value)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${inputTab === value ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded border border-stone-200 bg-white p-0.5 dark:border-stone-800 dark:bg-white/5" role="group" aria-label={t('diagram.engineAria')}>
          {[
            ['mermaid', 'Mermaid'],
            ['excalidraw', 'Excalidraw'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => handleEngineChange(value)}
              disabled={isGenerating}
              title={t('diagram.rendererVersionHint', { renderer: label })}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${engine === value ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={chartType}
          onChange={(event) => setChartType(event.target.value)}
          disabled={isGenerating}
          aria-label={t('diagram.chartTypeAria')}
          className="min-w-[120px] flex-1 rounded border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700 outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-800 dark:bg-white/5 dark:text-stone-300"
        >
          {Object.entries(CHART_TYPES).map(([key]) => <option key={key} value={key}>{t(`diagram.chartType.${key}`)}</option>)}
        </select>
      </div>
      {anchor && (
        <div className="flex shrink-0 items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-3 py-1.5 text-[11px] text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200">
          <Crosshair size={12} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t('diagram.anchorTo', { source: anchor.source })}</span>
          <button type="button" onClick={onClearAnchor} className="shrink-0 font-medium hover:text-indigo-950 dark:hover:text-indigo-50">{t('common.cancel')}</button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Chat onSendMessage={generate} isGenerating={isGenerating} initialInput={activeDrawing?.prompt || ''} initialChartType={chartType} initialEngine={engine} onEngineChange={handleEngineChange} activeTab={inputTab} onTabChange={setInputTab} chartType={chartType} onChartTypeChange={setChartType} />
      </div>
    </section>
  );
}
