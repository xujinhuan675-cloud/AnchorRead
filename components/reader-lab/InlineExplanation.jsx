'use client';

import { Check } from 'lucide-react';
import MarkdownSnippet from './MarkdownSnippet';

export default function InlineExplanation({ record, mastered, onMaster, onDelete, onRegisterCandidate, onDismissCandidate }) {
  const explanation = record.explanation || {};
  const display = explanation.display || explanation.plainExplanation;
  // 提问卡用靛蓝与解读卡的青绿区分：一眼分清"我问的"与"系统解读的"
  const isAsk = Boolean(record.ask);
  // 提问链路的候选词条：只展示待审阅项，入库/忽略后就地消失
  const pendingCandidates = Array.isArray(record.glossaryCandidates)
    ? record.glossaryCandidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate && candidate.status === 'pending')
    : [];

  return (
    <aside
      id={`reader-note-${record.id}`}
      // 上下间隙对齐正文行距（≈14px）：负上边距抵消前段 1.1em 底边距，下边距补足到行距
      className={`group reader-lab-inline-note relative -mt-1 mb-3.5 border-l-2 px-3 py-1 ${isAsk ? 'border-indigo-500 bg-indigo-50/70' : 'border-stone-950 dark:border-stone-100 bg-stone-100 dark:bg-white/10/70'}`}
      aria-label={`关于“${record.selectedText}”的${isAsk ? '回答' : '解读'}`}
    >
      {/* 删除是不可逆的低频管理动作，只在知识面板提供；行间卡只留高频可逆的“懂了” */}
      <button
        type="button"
        onClick={() => onMaster(record)}
        aria-pressed={mastered}
        aria-label={mastered ? '取消懂了' : '标记为懂了'}
        title={mastered ? '已懂（点击取消）' : '懂了'}
        className={`absolute right-1.5 top-1 flex h-5 w-5 items-center justify-center rounded outline-none focus-visible:ring-2 ${isAsk ? 'focus-visible:ring-indigo-500' : 'focus-visible:ring-stone-950 dark:ring-stone-100'} ${mastered ? (isAsk ? 'bg-indigo-100 text-indigo-700' : 'bg-stone-200 dark:bg-white/15 text-stone-950 dark:text-stone-100') : `text-stone-400 ${isAsk ? 'hover:bg-indigo-100 hover:text-indigo-700' : 'hover:bg-stone-200 dark:hover:bg-white/15 hover:text-stone-950 dark:text-stone-100'}`}`}
      >
        <Check size={12} aria-hidden="true" />
      </button>
      {/* 解读正文刻意小于正文，避免卡片过高反衬正文显得小 */}
      <div className="pr-6 text-[13px] leading-6 text-stone-800 dark:text-stone-200">
        <MarkdownSnippet text={display} />
      </div>
      {explanation.context && (
        <MarkdownSnippet
          text={explanation.context}
          className="mt-1 pr-6 text-xs leading-5 text-stone-500"
        />
      )}
      {pendingCandidates.length > 0 && (
        <div className={`mt-1.5 border-t pt-1.5 ${isAsk ? 'border-indigo-200/80' : 'border-stone-200 dark:border-stone-700/80'}`}>
          <p className={`mb-1 text-[11px] font-medium ${isAsk ? 'text-indigo-700' : 'text-stone-950 dark:text-stone-100'}`}>候选词条（确认后入术语表）</p>
          {pendingCandidates.map(({ candidate, index }) => (
            <div key={`${candidate.term}-${index}`} className="mb-1 flex items-start gap-2 rounded bg-white/70 px-2 py-1 last:mb-0">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-stone-800 dark:text-stone-200">
                  {candidate.term}
                  {Array.isArray(candidate.aliases) && candidate.aliases.length > 0 && (
                    <span className="font-normal text-stone-400">（{candidate.aliases.join('、')}）</span>
                  )}
                </p>
                <p className="text-[11px] leading-4 text-stone-500">{candidate.explanation}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onRegisterCandidate?.(record, index)}
                  className={`rounded border px-1.5 py-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 ${isAsk ? 'border-indigo-500 text-indigo-700 hover:bg-indigo-100 focus-visible:ring-indigo-400' : 'border-stone-950 dark:border-stone-100 text-stone-950 dark:text-stone-100 hover:bg-stone-200 dark:hover:bg-white/15 focus-visible:ring-stone-400 dark:ring-stone-500'}`}
                >
                  入库
                </button>
                <button
                  type="button"
                  onClick={() => onDismissCandidate?.(record, index)}
                  className="rounded border border-stone-300 dark:border-stone-700 px-1.5 py-0.5 text-[11px] text-stone-500 outline-none hover:bg-stone-100 dark:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400"
                >
                  忽略
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
