'use client';

import dynamic from 'next/dynamic';
import CodeEditor from '@/components/CodeEditor';
import MermaidCanvas from '@/components/MermaidCanvas';

const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), { ssr: false });

// 左侧主区域：图表画布 + 生成代码编辑区，与右侧对话区共享同一份 diagram 状态
// showCode=false 时只渲染画布（内联卡片默认），源码区由“查看源码”按钮控制
export default function DocumentDiagramCanvas({ diagram, showCode = true }) {
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
      <div className={`min-h-0 bg-gray-50 ${showCode ? 'flex-[3]' : 'flex-1'}`}>
        {engine === 'mermaid'
          ? <MermaidCanvas source={code} title="当前文档关系图" />
          : <ExcalidrawCanvas elements={elements} onElementsChange={changeElements} />}
      </div>
      {showCode && (
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
