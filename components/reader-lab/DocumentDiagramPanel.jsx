'use client';

import { Crosshair, History, LoaderCircle, Plus, Sparkles, Trash2 } from 'lucide-react';
import Chat from '@/components/Chat';
import { createDocumentDrawingId } from '@/lib/diagram-generation';

// 右侧对话区：只保留图表对话与图表管理，画布与代码区在左侧主区域渲染
export default function DocumentDiagramPanel({
  document,
  drawings,
  activeDrawing,
  onSelectDrawing,
  onCreateDrawing,
  onDeleteDrawing,
  onOpenHistory,
  anchor = null,
  onClearAnchor,
  diagram,
}) {
  const { engine, chartType, isGenerating, generate, handleEngineChange } = diagram;

  return (
    <section className="flex h-full min-h-0 flex-col bg-white" aria-label="文档关系图对话">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2.5">
        <Sparkles size={15} className="text-teal-700" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">文档关系图</h2>
        <button type="button" onClick={() => onCreateDrawing({ id: createDocumentDrawingId(document.id), documentId: document.id, title: '未命名图解', engine: 'excalidraw', chartType: 'auto', source: '', createdAt: Date.now(), updatedAt: Date.now() })} className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-50" title="新建图解" aria-label="新建图解"><Plus size={15} /></button>
        <button type="button" onClick={onOpenHistory} className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-50" title="打开历史" aria-label="打开历史"><History size={15} /></button>
      </header>
      {anchor && (
        <div className="flex shrink-0 items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-3 py-1.5 text-[11px] text-indigo-800">
          <Crosshair size={12} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">将锚定到选区：{anchor.source}</span>
          <button type="button" onClick={onClearAnchor} className="shrink-0 font-medium hover:text-indigo-950">取消</button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Chat onSendMessage={generate} isGenerating={isGenerating} initialInput={activeDrawing?.prompt || ''} initialChartType={chartType} initialEngine={engine} onEngineChange={handleEngineChange} />
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-500">
        <select value={activeDrawing?.id || ''} onChange={(event) => onSelectDrawing(event.target.value)} className="min-w-0 flex-1 truncate border-0 bg-transparent text-[11px] outline-none" aria-label="选择图解">
          <option value="">未命名图解</option>
          {drawings.map((drawing) => <option key={drawing.id} value={drawing.id}>{drawing.title || drawing.id}</option>)}
        </select>
        {activeDrawing ? <button type="button" onClick={() => onDeleteDrawing(activeDrawing.id)} className="flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600" title="删除当前图解" aria-label="删除当前图解"><Trash2 size={13} /></button> : null}
        {isGenerating ? <LoaderCircle size={13} className="animate-spin" /> : null}
      </footer>
    </section>
  );
}
