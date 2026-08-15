'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, CheckCircle2, Eye, Trash2 } from 'lucide-react';
import GlossaryManager from '@/components/reader-lab/GlossaryManager';
import { flashcardStore } from '@/lib/flashcard-store';
import { formatDue, RATING, RATING_LABELS } from '@/lib/fsrs';

const TABS = [
  { id: 'explanations', label: '解读' },
  { id: 'terms', label: '术语' },
  { id: 'glossary', label: '术语表' },
  { id: 'flashcards', label: '闪卡复习' },
];

const DEMO_NOTICE = '以下为本地 Demo 示例解读，仅用于演示功能，不代表真实 AI 分析结果。';

const RATING_STYLES = {
  [RATING.AGAIN]: 'border-red-200 text-red-700 hover:bg-red-50',
  [RATING.HARD]: 'border-amber-200 text-amber-700 hover:bg-amber-50',
  [RATING.GOOD]: 'border-teal-200 text-teal-700 hover:bg-teal-50',
  [RATING.EASY]: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
};

function roleLabel(record) {
  if (record.role === 'term') return '术语';
  if (record.role === 'concept') return '概念';
  return '关键段';
}

function demoLabel(record) {
  if (record.demo) return 'Demo 示例';
  if (record.batchAnalysis) return '全文分析';
  return '';
}

function FlashcardQuiz({ documentId }) {
  const [stats, setStats] = useState({ total: 0, due: 0, reviewedToday: 0 });
  const [libraryCards, setLibraryCards] = useState([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [session, setSession] = useState(null);

  const refresh = useCallback(() => {
    setStats(flashcardStore.getStats(Date.now(), documentId));
    setLibraryCards(flashcardStore.getForDocument(documentId));
  }, [documentId]);

  useEffect(() => {
    refresh();
    window.addEventListener('flashcards-changed', refresh);
    return () => window.removeEventListener('flashcards-changed', refresh);
  }, [refresh]);

  const startSession = () => {
    const queue = flashcardStore.getDueCards(Date.now(), documentId);
    if (!queue.length) return;
    setSession({ queue, index: 0, revealed: false, reviewed: 0, finished: false });
  };

  const handleRating = (rating) => {
    if (!session || session.finished) return;
    const current = session.queue[session.index];
    flashcardStore.review(current.id, rating);
    const reviewed = session.reviewed + 1;
    if (session.index + 1 >= session.queue.length) {
      setSession({ ...session, reviewed, finished: true });
      return;
    }
    setSession({ ...session, index: session.index + 1, revealed: false, reviewed });
  };

  // 跳过不计入复习，卡片仍保持到期状态，下次开始复习时会再次出现
  const handleSkip = () => {
    if (!session || session.finished) return;
    if (session.index + 1 >= session.queue.length) {
      setSession({ ...session, finished: true });
      return;
    }
    setSession({ ...session, index: session.index + 1, revealed: false });
  };

  if (session?.finished) {
    return (
      <div className="mx-auto mt-6 w-full max-w-sm rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center">
        <p className="text-sm font-semibold text-emerald-900">本轮复习完成</p>
        <p className="mt-1 text-xs text-emerald-700">本轮共复习 {session.reviewed} 张闪卡，下一批到期卡会按 FSRS 间隔自动安排。</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={startSession} className="h-8 rounded border border-emerald-300 bg-white px-3 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
            再查一批到期卡
          </button>
          <button type="button" onClick={() => setSession(null)} className="h-8 rounded border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:bg-gray-50">
            返回
          </button>
        </div>
      </div>
    );
  }

  if (session) {
    const current = session.queue[session.index];
    return (
      <div className="p-4" aria-label="闪卡复习">
        <div className="flex items-center justify-between text-[11px] text-gray-400">
          <span>第 {session.index + 1}/{session.queue.length} 张 · 已复习 {session.reviewed}</span>
          <span className="flex items-center gap-3">
            <button type="button" onClick={handleSkip} className="font-medium text-gray-500 hover:text-gray-800">跳过</button>
            <button type="button" onClick={() => setSession(null)} className="font-medium text-gray-500 hover:text-gray-800">退出</button>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSession({ ...session, revealed: true })}
          className="mt-3 flex min-h-32 w-full flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-5 text-center transition-colors hover:border-teal-300"
        >
          <p className="text-sm font-medium leading-6 text-gray-900">{current.front}</p>
          {!session.revealed && <span className="mt-3 text-xs text-gray-400">点击卡片显示答案</span>}
        </button>
        {session.revealed && (
          <>
            <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-4">
              <p className="text-sm leading-6 text-teal-900">{current.back}</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => handleRating(rating)}
                  className={`h-9 rounded border text-xs font-medium ${RATING_STYLES[rating]}`}
                >
                  {RATING_LABELS[rating]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-4" aria-label="闪卡复习">
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>{stats.due} 张待复习 · 卡库 {stats.total} 张</span>
        <span className="text-gray-400">今日已复习 {stats.reviewedToday}</span>
      </div>
      <button
        type="button"
        onClick={startSession}
        disabled={stats.due === 0}
        className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded bg-gray-900 text-xs font-medium text-white outline-none hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
      >
        <Brain size={14} aria-hidden="true" />
        {stats.due > 0 ? `开始复习（${stats.due}）` : '当前文档暂无到期闪卡'}
      </button>
      {stats.total === 0 && (
        <p className="mt-3 rounded border border-dashed border-gray-200 bg-white p-3 text-xs leading-5 text-gray-500">
          还没有为这篇文档生成闪卡。阅读时在顶部工具栏点击"生成闪卡"，即可把重点转成间隔复习卡片。
        </p>
      )}

      <button
        type="button"
        onClick={() => setLibraryOpen((open) => !open)}
        aria-expanded={libraryOpen}
        className="mt-4 flex w-full items-center justify-between text-xs font-medium text-gray-500 hover:text-gray-800"
      >
        卡片库（{libraryCards.length}）
        <Eye size={13} aria-hidden="true" />
      </button>
      {libraryOpen && (
        libraryCards.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">暂无闪卡。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {libraryCards.map((card) => (
              <li key={card.id} className="flex items-start justify-between gap-2 rounded border border-gray-200 bg-white p-2.5">
                <div className="min-w-0">
                  <p className="break-words text-xs leading-5 text-gray-700">{card.front}</p>
                  <p className="mt-0.5 text-[10px] text-gray-400">{formatDue(card.due)} · 已复习 {card.reps} 次</p>
                </div>
                <button
                  type="button"
                  onClick={() => flashcardStore.remove(card.id)}
                  aria-label={`删除闪卡"${card.front}"`}
                  className="shrink-0 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

export default function KnowledgePanel({
  documentId = '',
  document,
  explanations = [],
  terms = [],
  mastery = {},
  glossary = [],
  onFocus,
  onMaster,
  onDelete,
  onFocusTerm,
  onMasterTerm,
  onSaveGlossaryEntry,
  onRemoveGlossaryEntry,
  isStale,
  flashcardSignal = 0,
}) {
  const [activeTab, setActiveTab] = useState('explanations');
  const [dueCount, setDueCount] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    if (flashcardSignal > 0) setActiveTab('flashcards');
  }, [flashcardSignal]);

  useEffect(() => {
    const update = () => setDueCount(flashcardStore.getDueCount(Date.now(), documentId));
    update();
    window.addEventListener('flashcards-changed', update);
    return () => window.removeEventListener('flashcards-changed', update);
  }, [documentId]);

  const hasDemo = useMemo(() => explanations.some((record) => record.demo), [explanations]);
  const masteredCount = explanations.filter((record) => mastery[record.id]).length;

  const focusTerm = (termId) => {
    onFocusTerm?.(termId);
    if (listRef.current) listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderTerms = () => (
    <div className="p-4" aria-label="术语理解列表">
      {terms.length === 0 ? (
        <p className="rounded border border-dashed border-gray-200 bg-white p-3 text-xs leading-5 text-gray-500">
          还没有生成术语卡。选中原文后使用"识别术语"。
        </p>
      ) : (
        <ul className="space-y-3">
          {terms.map((term) => {
            const mastered = term.status === 'mastered';
            const aliasList = Array.isArray(term.aliases) ? term.aliases : [];
            const stale = isStale?.(term, document?.content);
            return (
              <li key={term.id} className="rounded border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-gray-800">
                    {term.term || term.name}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {stale && (
                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                        源文已变化
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => focusTerm(term.id)}
                      className="rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                    >
                      定位原文
                    </button>
                    {onMasterTerm && (
                      <button
                        type="button"
                        onClick={() => onMasterTerm(term)}
                        aria-label={mastered ? '取消懂了' : '标记为懂了'}
                        className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium ${
                          mastered
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <CheckCircle2 size={12} aria-hidden="true" />
                        {mastered ? '已懂' : '懂了'}
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 break-words text-xs leading-5 text-gray-600">{term.explanation}</p>
                {aliasList.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {aliasList.map((alias) => (
                      <span key={alias} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">
                        {alias}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 rounded bg-gray-50 px-2 py-1 text-[11px] leading-5 text-gray-500">
                  原文锚点：{term.selectedText || term.term}
                </p>
                <p className="mt-2 text-[11px] text-gray-400">
                  {term.source === 'demo' ? 'Demo 术语示例' : 'AI 识别'} · 已懂的术语跨文档再次出现时不再解释。
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const renderExplanations = () => (
    <div className="p-4" aria-label="解读列表">
      {hasDemo && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
          {DEMO_NOTICE}
        </p>
      )}
      {explanations.length === 0 ? (
        <p className="rounded border border-dashed border-gray-200 bg-white p-3 text-xs leading-5 text-gray-500">
          还没有解读记录。选中原文后使用"解释这段"。
        </p>
      ) : (
        <ul className="space-y-3">
          {explanations.map((record) => {
            const stale = isStale?.(record, document?.content);
            return (
            <li key={record.id} className="rounded border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {roleLabel(record)}
                  </span>
                  {stale && (
                    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                      源文已变化
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onFocus?.(record.id)}
                    className="rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                  >
                    定位
                  </button>
                  <button
                    type="button"
                    onClick={() => onMaster?.(record.id)}
                    aria-label={mastery[record.id] ? '取消理解标记' : '标记为懂了'}
                    className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium ${
                      mastery[record.id]
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <CheckCircle2 size={12} aria-hidden="true" />
                    {mastery[record.id] ? '已懂' : '懂了'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete?.(record.id)}
                    aria-label="删除解读"
                    title="删除解读"
                    className="flex items-center justify-center rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p className="mt-2 break-words text-xs font-medium leading-5 text-gray-800">{record.selectedText}</p>
              <p className="mt-2 break-words text-xs leading-5 text-gray-600">{record.explanation?.summary || ''}</p>
              <p className="mt-2 break-words text-xs leading-5 text-gray-500">{record.explanation?.context || ''}</p>
              <p className="mt-2 text-[11px] text-gray-400">
                {formatDate(record.createdAt)}
                {demoLabel(record) ? ` · ${demoLabel(record)}` : ''}
                {record.source === 'api' ? ' · AI 解读' : ''}
              </p>
            </li>
            );
          })}
        </ul>
      )}
      {explanations.length > 0 && (
        <p className="mt-4 text-center text-[11px] text-gray-400">
          已懂 {masteredCount}/{explanations.length} 条 · "懂了"只影响你的复习清单，不会删除解读。
        </p>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fafafa]">
      <div className="border-b border-gray-200 bg-white">
        <div className="flex" role="tablist" aria-label="知识面板视图">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex-1 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.id === 'flashcards' && dueCount > 0 && (
                <span className="absolute right-1 top-1 min-w-[15px] rounded-full bg-red-500 px-1 text-center text-[9px] leading-[15px] text-white">
                  {dueCount > 99 ? '99+' : dueCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'terms' && renderTerms()}
      {activeTab === 'glossary' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GlossaryManager
            entries={glossary}
            onSave={onSaveGlossaryEntry}
            onRemove={onRemoveGlossaryEntry}
          />
        </div>
      )}
      {activeTab === 'explanations' && (
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {renderExplanations()}
        </div>
      )}
      {activeTab === 'flashcards' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FlashcardQuiz documentId={documentId} />
        </div>
      )}
    </div>
  );
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
