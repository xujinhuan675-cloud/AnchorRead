'use client';

import { Check, Trash2 } from 'lucide-react';

export default function InlineExplanation({ record, mastered, onMaster, onDelete }) {
  return (
    <aside
      id={`reader-note-${record.id}`}
      className="reader-lab-inline-note my-5 border-l-2 border-teal-600 bg-teal-50/70 px-4 py-3"
      aria-label={`关于“${record.selectedText}”的行间解读`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-teal-800">行间解读</span>
            {record.isDemo && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                Demo
              </span>
            )}
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-gray-500">
            原文范围：{record.selectedText}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
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
        {record.explanation.plainExplanation}
      </p>
      {record.explanation.context && (
        <p className="mt-2 text-xs leading-5 text-gray-500">
          {record.explanation.context}
        </p>
      )}
    </aside>
  );
}
