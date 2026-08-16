'use client';

import { Check } from 'lucide-react';
import MarkdownSnippet from './MarkdownSnippet';

export default function InlineExplanation({ record, mastered, onMaster, onDelete }) {
  const explanation = record.explanation || {};
  const display = explanation.display || explanation.plainExplanation;

  return (
    <aside
      id={`reader-note-${record.id}`}
      // 上下间隙对齐正文行距（≈14px）：负上边距抵消前段 1.1em 底边距，下边距补足到行距
      className="group reader-lab-inline-note relative -mt-1 mb-3.5 border-l-2 border-teal-600 bg-teal-50/70 px-3 py-1"
      aria-label={`关于“${record.selectedText}”的解读`}
    >
      {/* 删除是不可逆的低频管理动作，只在知识面板提供；行间卡只留高频可逆的“懂了” */}
      <button
        type="button"
        onClick={() => onMaster(record)}
        aria-pressed={mastered}
        aria-label={mastered ? '取消懂了' : '标记为懂了'}
        title={mastered ? '已懂（点击取消）' : '懂了'}
        className={`absolute right-1.5 top-1 flex h-5 w-5 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${mastered ? 'bg-teal-100 text-teal-700' : 'text-gray-400 hover:bg-teal-100 hover:text-teal-700'}`}
      >
        <Check size={12} aria-hidden="true" />
      </button>
      {/* 解读正文刻意小于正文，避免卡片过高反衬正文显得小 */}
      <div className="pr-6 text-[13px] leading-6 text-gray-800">
        <MarkdownSnippet text={display} />
      </div>
      {explanation.context && (
        <MarkdownSnippet
          text={explanation.context}
          className="mt-1 pr-6 text-xs leading-5 text-gray-500"
        />
      )}
    </aside>
  );
}
