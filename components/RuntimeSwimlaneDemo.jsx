'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { createRuntimeSwimlaneDemoElements } from '@/lib/excalidraw-runtime-demo';

const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), { ssr: false });

export default function RuntimeSwimlaneDemo() {
  const [elements, setElements] = useState(() => createRuntimeSwimlaneDemoElements());

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-white text-stone-900">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">Excalidraw · 企业 Agent 运行时链路</h1>
          <p className="truncate text-[11px] text-stone-500">所有图形均可选择、拖动、改字与继续绘制</p>
        </div>
        <button
          type="button"
          onClick={() => setElements(createRuntimeSwimlaneDemoElements())}
          className="flex h-8 items-center gap-1.5 rounded border border-stone-200 px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-400"
        >
          <RotateCcw size={14} aria-hidden="true" />
          重置示例
        </button>
        <Link
          href="/?view=diagram"
          className="flex h-8 items-center rounded bg-stone-900 px-3 text-xs font-medium text-white hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-400"
        >
          返回图解工作区
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        <ExcalidrawCanvas elements={elements} onElementsChange={setElements} />
      </div>
    </main>
  );
}

