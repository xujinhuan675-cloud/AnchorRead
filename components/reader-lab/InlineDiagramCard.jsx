'use client';

import { useState } from 'react';
import { FileCode2, LoaderCircle, PenTool } from 'lucide-react';
import { useDocumentDiagram } from '@/components/reader-lab/use-document-diagram';
import DocumentDiagramCanvas from '@/components/reader-lab/DocumentDiagramCanvas';

const ENGINE_OPTIONS = [
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'excalidraw', label: 'Excalidraw' },
];

// 划词图解生成中的占位卡：锚在选区下方，完成后被正式图解卡替换
export function InlineDiagramPlaceholder({ source }) {
  return (
    <aside
      className="my-5 flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3"
      aria-label={`正在为“${source}”生成图解`}
    >
      <LoaderCircle size={14} className="animate-spin text-indigo-600" aria-hidden="true" />
      <span className="text-xs font-medium text-indigo-800">图解生成中，完成后插入此处</span>
    </aside>
  );
}

// 行间解读已锚定在上方原文，本卡片直接嵌入完整图表组件（画布 + 代码编辑 + 引擎切换），
// 让原文里就能查看与微调图表，保留原图表工作台的查看与编辑能力
export default function InlineDiagramCard({ drawing, document, onCreateDrawing, onPersistDrawing, onNotice }) {
  const diagram = useDocumentDiagram({
    document,
    activeDrawing: drawing,
    anchor: null,
    onCreateDrawing,
    onPersistDrawing,
    onClearAnchor: () => {},
    onNotice,
  });
  const { engine, handleEngineChange } = diagram;
  const [showCode, setShowCode] = useState(false);

  return (
    <aside
      className="my-5 overflow-hidden rounded-lg border border-indigo-200 bg-white"
      aria-label={`锚定“${drawing.anchor?.source || drawing.title}”的文档图解`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 dark:border-stone-800 bg-indigo-50/60 px-4 py-2.5">
        <PenTool size={13} className="shrink-0 text-indigo-700" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-indigo-800">文档图解</span>
        <span className="truncate text-[11px] font-medium text-stone-600 dark:text-stone-400">
          {drawing.title || '未命名图解'}
        </span>
        <div
          className="ml-auto flex shrink-0 items-center gap-1"
          role="group"
          aria-label="图解视图控制"
        >
          <button
            type="button"
            onClick={() => setShowCode((current) => !current)}
            aria-pressed={showCode}
            className={`flex h-7 items-center gap-1 rounded border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${showCode ? 'border-indigo-300 bg-white text-indigo-800 shadow-sm' : 'border-stone-200 dark:border-stone-800 bg-white text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:text-stone-100'}`}
          >
            <FileCode2 size={13} aria-hidden="true" />
            {showCode ? '收起源码' : '查看源码'}
          </button>
          <div className="flex rounded border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-white/5 p-0.5" role="group" aria-label="切换图解引擎">
            {ENGINE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleEngineChange(value)}
                aria-pressed={engine === value}
                className={`flex h-7 items-center rounded px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${engine === value ? 'bg-white text-stone-900 dark:text-stone-100 shadow-sm' : 'text-stone-500 hover:text-stone-800 dark:text-stone-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={showCode ? 'h-[560px]' : 'h-[420px]'}>
        <DocumentDiagramCanvas diagram={diagram} showCode={showCode} />
      </div>
    </aside>
  );
}
