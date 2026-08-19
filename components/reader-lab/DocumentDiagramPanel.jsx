'use client';

import { Check, ChevronDown, Crosshair, History, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Chat from '@/components/Chat';
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
  onDeleteDrawing,
  onOpenHistory,
  onRenameDrawing = () => {},
  anchor = null,
  onClearAnchor,
  diagram,
}) {
  const { engine, chartType, setChartType, isGenerating, generate, handleEngineChange } = diagram;
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
    <section className="flex h-full min-h-0 flex-col bg-white" aria-label={standalone ? '自由图解对话' : '文档关系图对话'}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 dark:border-stone-800 bg-white py-2.5 pl-3 pr-12 lg:pr-3">
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
            aria-label="重命名图解"
            className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-sm font-semibold text-stone-900 outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-700 dark:bg-white/5 dark:text-stone-100"
          />
        ) : (
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={handleSelectClick}
              onDoubleClick={handleSelectDoubleClick}
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-label="选择图解"
              title="单击切换图解 · 双击重命名"
              className="flex w-full items-center gap-1 rounded border border-stone-200 bg-white px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-800 dark:bg-white/5"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{activeDrawing?.title || '未命名图解'}</span>
              <ChevronDown size={12} className="shrink-0 text-stone-400" aria-hidden="true" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
                <ul role="listbox" aria-label="图解列表" className="absolute left-0 top-8 z-50 max-h-56 w-full min-w-36 overflow-auto rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-800 dark:bg-stone-900">
                  {drawings.length === 0
                    ? <li className="px-2 py-1.5 text-xs text-stone-400">暂无图解，点右侧 + 新建</li>
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
        {activeDrawing ? <button type="button" onClick={() => onDeleteDrawing(activeDrawing.id)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-stone-400 hover:bg-red-50 hover:text-red-600" title="删除当前图解" aria-label="删除当前图解"><Trash2 size={13} /></button> : null}
        {isGenerating ? <LoaderCircle size={13} className="shrink-0 animate-spin text-stone-400" aria-hidden="true" /> : null}
        <button type="button" onClick={() => onCreateDrawing({ id: createDocumentDrawingId(document.id), documentId: document.id, title: '未命名图解', engine: 'mermaid', chartType: 'auto', source: '', createdAt: Date.now(), updatedAt: Date.now() })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-stone-500 outline-none hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 dark:text-stone-400 dark:hover:text-stone-100" title="新建图解" aria-label="新建图解"><Plus size={15} /></button>
        <button type="button" onClick={onOpenHistory} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-stone-500 outline-none hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 dark:text-stone-400 dark:hover:text-stone-100" title="打开历史" aria-label="打开历史"><History size={15} /></button>
      </header>
      {/* 控制子栏：输入模式、引擎与图类型集中收纳在头部，Chat 内容区只留输入本身 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50 px-3 py-1.5 dark:border-stone-800 dark:bg-white/5">
        <div className="flex rounded border border-stone-200 bg-white p-0.5 dark:border-stone-800" role="group" aria-label="输入方式">
          {[
            ['text', '文本'],
            ['file', '文件'],
            ['image', '图片'],
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
        <div className="flex rounded border border-stone-200 bg-white p-0.5 dark:border-stone-800" role="group" aria-label="绘图引擎">
          {[
            ['mermaid', 'Mermaid'],
            ['excalidraw', 'Excalidraw'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => handleEngineChange(value)}
              disabled={isGenerating}
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
          aria-label="图类型"
          className="min-w-[120px] flex-1 rounded border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700 outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-800 dark:bg-white/5 dark:text-stone-300"
        >
          {Object.entries(CHART_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      {anchor && (
        <div className="flex shrink-0 items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-3 py-1.5 text-[11px] text-indigo-800">
          <Crosshair size={12} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">将锚定到选区：{anchor.source}</span>
          <button type="button" onClick={onClearAnchor} className="shrink-0 font-medium hover:text-indigo-950">取消</button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Chat onSendMessage={generate} isGenerating={isGenerating} initialInput={activeDrawing?.prompt || ''} initialChartType={chartType} initialEngine={engine} onEngineChange={handleEngineChange} activeTab={inputTab} onTabChange={setInputTab} chartType={chartType} onChartTypeChange={setChartType} />
      </div>
    </section>
  );
}
