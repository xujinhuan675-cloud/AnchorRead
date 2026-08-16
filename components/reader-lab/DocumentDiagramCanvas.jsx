'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { FileCode2 } from 'lucide-react';
import CodeEditor from '@/components/CodeEditor';
import MermaidCanvas from '@/components/MermaidCanvas';

const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), { ssr: false });

// 左侧主区域：图表画布 + 生成代码编辑区，与右侧对话区共享同一份 diagram 状态
// 源码编辑区默认收起：阅读/浏览场景画布是主角，需要改码时再用「源码」开关展开；
// 内联卡片传入 showCode 时仍按外部控制为准
export default function DocumentDiagramCanvas({ diagram, showCode }) {
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

  return (
    <section className="flex h-full min-h-0 flex-col bg-gray-50" aria-label="文档关系图画布">
      {/* 源码开关放在画布上方工具条：悬浮在画布右上角会与 Excalidraw 自带 Library 按钮重叠 */}
      {typeof showCode !== 'boolean' && (
        <div className="flex shrink-0 items-center border-b border-gray-200 bg-white px-3 py-1.5">
          <span className="text-[11px] font-medium text-gray-400">图解画布</span>
          <button
            type="button"
            onClick={() => setCodeOpen((open) => !open)}
            aria-pressed={codeOpen}
            className={`ml-auto flex h-7 items-center gap-1.5 rounded border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${codeOpen ? 'border-indigo-300 bg-white text-indigo-800 shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:text-gray-900'}`}
          >
            <FileCode2 size={13} aria-hidden="true" />
            {codeOpen ? '收起源码' : '源码'}
          </button>
        </div>
      )}
      <div className={`min-h-0 bg-gray-50 ${isCodeVisible ? 'flex-[3]' : 'flex-1'}`}>
        {engine === 'mermaid'
          ? <MermaidCanvas source={code} title="当前文档关系图" />
          : <ExcalidrawCanvas elements={elements} onElementsChange={changeElements} />}
      </div>
      {isCodeVisible && (
        <div className="min-h-0 flex-[2] border-t border-gray-200 bg-white">
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
