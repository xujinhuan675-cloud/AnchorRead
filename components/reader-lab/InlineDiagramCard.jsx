'use client';

import { useState } from 'react';
import { FileCode2, PenTool } from 'lucide-react';
import { useDocumentDiagram } from '@/components/reader-lab/use-document-diagram';
import DocumentDiagramCanvas from '@/components/reader-lab/DocumentDiagramCanvas';

const ENGINE_OPTIONS = [
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'excalidraw', label: 'Excalidraw' },
];

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
      aria-label={`锚定“${drawing.anchor?.source || drawing.title}”的文档图表`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-indigo-50/60 px-4 py-2.5">
        <PenTool size={13} className="shrink-0 text-indigo-700" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-indigo-800">文档图表</span>
        <span className="truncate text-[11px] font-medium text-gray-600">
          {drawing.title || '未命名图表'}
        </span>
        <div
          className="ml-auto flex shrink-0 items-center gap-1"
          role="group"
          aria-label="图表视图控制"
        >
          <button
            type="button"
            onClick={() => setShowCode((current) => !current)}
            aria-pressed={showCode}
            className={`flex h-7 items-center gap-1 rounded border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${showCode ? 'border-indigo-300 bg-white text-indigo-800 shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:text-gray-900'}`}
          >
            <FileCode2 size={13} aria-hidden="true" />
            {showCode ? '收起源码' : '查看源码'}
          </button>
          <div className="flex rounded border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label="切换图表引擎">
            {ENGINE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleEngineChange(value)}
                aria-pressed={engine === value}
                className={`flex h-7 items-center rounded px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${engine === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
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
