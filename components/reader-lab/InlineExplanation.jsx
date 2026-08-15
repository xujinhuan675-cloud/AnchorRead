'use client';

import { Check, Trash2 } from 'lucide-react';

const ROLE_LABELS = Object.freeze({
  core: '核心观点',
  concept: '概念定义',
  evidence: '关键论据',
  conclusion: '结论推断',
});

export default function InlineExplanation({ record, mastered, onMaster, onDelete }) {
  const explanation = record.explanation || {};
  const display = explanation.display || explanation.plainExplanation;

  return (
    <aside
      id={`reader-note-${record.id}`}
      className="group reader-lab-inline-note my-5 border-l-2 border-teal-600 bg-teal-50/70 px-4 py-3"
      aria-label={`关于“${record.selectedText}”的行间解读`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-teal-800">行间解读</span>
            {ROLE_LABELS[record.role] && (
              <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                {ROLE_LABELS[record.role]}
              </span>
            )}
            {record.isDemo && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                Demo
              </span>
            )}
          </div>
        </div>
        {/* 操作按钮悬浮时才显示，降低阅读流中的视觉干扰；键盘聚焦时同样可见 */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onMaster(record)}
            aria-pressed={mastered}
            className={`flex h-8 items-center gap-1 rounded px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${mastered ? 'bg-teal-700 text-white' : 'border border-teal-200 bg-white text-teal-800 hover:bg-teal-100'}`}
          >
            <Check size={14} aria-hidden="true" />
            {mastered ? '已懂' : '懂了'}
          </button>
          <button
            type="button"
            onClick={() => onDelete(record)}
            aria-label="删除这条解读"
            title="删除解读"
            className="flex h-8 w-8 items-center justify-center rounded text-gray-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="mt-3 text-sm leading-7 text-gray-800">
        {display}
      </p>
      {explanation.context && (
        <p className="mt-2 text-xs leading-5 text-gray-500">
          {explanation.context}
        </p>
      )}
    </aside>
  );
}
