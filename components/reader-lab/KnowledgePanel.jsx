'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Brain, Check, Eye, GraduationCap, NotebookText, Trash2, X } from 'lucide-react';
import { flashcardStore } from '@/lib/flashcard-store';
import { formatDue, RATING, RATING_LABELS } from '@/lib/fsrs';
import { readerRoleLayer } from '@/lib/reader-analysis';
import MarkdownSnippet from './MarkdownSnippet';

const TABS = [
  { id: 'explanations', label: '解读' },
  { id: 'structure', label: '重点' },
  { id: 'terms', label: '白话' },
  { id: 'flashcards', label: '闪卡' },
];

const DEMO_NOTICE = '以下为本地 Demo 示例解读，仅用于演示功能，不代表真实 AI 分析结果。';

const RATING_STYLES = {
  [RATING.AGAIN]: 'border-red-200 text-red-700 hover:bg-red-50',
  [RATING.HARD]: 'border-amber-200 text-amber-700 hover:bg-amber-50',
  [RATING.GOOD]: 'border-stone-200 dark:border-stone-700 text-stone-950 dark:text-stone-100 hover:bg-stone-100 dark:bg-white/10',
  [RATING.EASY]: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
};

function roleLabel(record) {
  if (record.role === 'term') return '术语';
  if (record.role === 'core') return '中心论点';
  if (record.role === 'subthesis') return '分论点';
  if (record.role === 'concept') return '概念';
  if (record.role === 'evidence') return '论据';
  if (record.role === 'countermeasure') return '对策';
  if (record.role === 'case') return '案例';
  if (record.role === 'conclusion') return '结论';
  if (record.role === 'background') return '背景';
  return '关键段';
}

const STRUCTURE_LAYER_SECTIONS = [
  { layer: 'article', label: '文章层 · 中心论点', chip: 'bg-pink-100 text-pink-700' },
  { layer: 'paragraph', label: '段落层 · 分论点', chip: 'bg-yellow-100 text-yellow-800' },
];
const MARK_KIND_LABELS = { center: '服务中心', quote: '金句', idiom: '成语' };

// 闪卡存储是 localStorage 外部源，统一用 useSyncExternalStore 订阅；
// 快照按版本号缓存（含读取时刻），保证 getSnapshot 返回稳定引用，
// 也避免在渲染期调用 Date.now 这类不纯函数
let cardsVersion = 0;
const cardsSnapshot = { version: -1, cards: [], readAt: 0 };

function subscribeFlashcards(callback) {
  const handler = () => {
    cardsVersion += 1;
    callback();
  };
  window.addEventListener('flashcards-changed', handler);
  return () => window.removeEventListener('flashcards-changed', handler);
}

function getAllCardsSnapshot() {
  if (cardsSnapshot.version !== cardsVersion) {
    cardsSnapshot.version = cardsVersion;
    cardsSnapshot.cards = flashcardStore.getAll();
    cardsSnapshot.readAt = Date.now();
  }
  return cardsSnapshot;
}

function demoLabel(record) {
  if (record.demo) return 'Demo 示例';
  if (record.batchAnalysis) return '全文分析';
  return '';
}

function FlashcardQuiz({ documentId, onExportAnki = null }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [session, setSession] = useState(null);

  const { cards: allCards, readAt } = useSyncExternalStore(subscribeFlashcards, getAllCardsSnapshot, getAllCardsSnapshot);
  const libraryCards = useMemo(
    () => allCards.filter((card) => card.documentId === documentId),
    [allCards, documentId]
  );
  const stats = useMemo(() => {
    const todayStart = new Date(readAt);
    todayStart.setHours(0, 0, 0, 0);
    return {
      total: libraryCards.length,
      due: libraryCards.filter((card) => card.due <= readAt).length,
      reviewedToday: libraryCards.filter((card) => card.lastReview >= todayStart.getTime()).length,
    };
  }, [libraryCards, readAt]);

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
          <button type="button" onClick={() => setSession(null)} className="h-8 rounded border border-stone-200 dark:border-stone-800 bg-white px-3 text-xs font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:bg-white/5">
            返回
          </button>
        </div>
      </div>
    );
  }

  if (session) {
    const current = session.queue[session.index];
    return (
      <div className="p-4" aria-label="闪卡">
        <div className="flex items-center justify-between text-[11px] text-stone-400">
          <span>第 {session.index + 1}/{session.queue.length} 张 · 已复习 {session.reviewed}</span>
          <span className="flex items-center gap-3">
            <button type="button" onClick={handleSkip} className="font-medium text-stone-500 hover:text-stone-800 dark:text-stone-200">跳过</button>
            <button type="button" onClick={() => setSession(null)} className="font-medium text-stone-500 hover:text-stone-800 dark:text-stone-200">退出</button>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSession({ ...session, revealed: true })}
          className="mt-3 flex min-h-32 w-full flex-col items-center justify-center rounded-lg border border-stone-200 dark:border-stone-800 bg-white p-5 text-center transition-colors hover:border-stone-400 dark:hover:border-stone-500"
        >
          <p className="text-sm font-medium leading-6 text-stone-900 dark:text-stone-100">
            <MarkdownSnippet text={current.front} />
          </p>
          {!session.revealed && <span className="mt-3 text-xs text-stone-400">点击卡片显示答案</span>}
        </button>
        {session.revealed && (
          <>
            <div className="mt-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-white/10 p-4">
              <div className="text-sm leading-6 text-stone-900 dark:text-stone-200">
                <MarkdownSnippet text={current.back} />
              </div>
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
    <div className="p-4" aria-label="闪卡">
      <div className="flex items-center justify-between text-xs text-stone-600 dark:text-stone-400">
        <span>{stats.due} 张待复习 · 卡库 {stats.total} 张</span>
        <span className="text-stone-400">今日已复习 {stats.reviewedToday}</span>
      </div>
      <button
        type="button"
        onClick={startSession}
        disabled={stats.due === 0}
        className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded bg-stone-900 text-xs font-medium text-white outline-none hover:bg-stone-700 dark:bg-stone-300 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:bg-stone-200 dark:bg-white/15 disabled:text-stone-400"
      >
        <Brain size={14} aria-hidden="true" />
        {stats.due > 0 ? `开始复习（${stats.due}）` : '当前文档暂无到期闪卡'}
      </button>
      {onExportAnki && (
        <button
          type="button"
          onClick={onExportAnki}
          disabled={stats.total === 0}
          className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-500 outline-none hover:text-stone-900 dark:text-stone-100 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-40"
        >
          <GraduationCap size={12} aria-hidden="true" />
          导出 Anki
        </button>
      )}
      {stats.total === 0 && (
        <p className="mt-3 rounded border border-dashed border-stone-200 dark:border-stone-800 bg-white p-3 text-xs leading-5 text-stone-500">
          还没有为这篇文档生成闪卡。阅读时在顶部工具栏点击「生成闪卡」，即可把重点转成间隔复习卡片。
        </p>
      )}

      <button
        type="button"
        onClick={() => setLibraryOpen((open) => !open)}
        aria-expanded={libraryOpen}
        className="mt-4 flex w-full items-center justify-between text-xs font-medium text-stone-500 hover:text-stone-800 dark:text-stone-200"
      >
        卡片库（{libraryCards.length}）
        <Eye size={13} aria-hidden="true" />
      </button>
      {libraryOpen && (
        libraryCards.length === 0 ? (
          <p className="mt-2 text-xs text-stone-400">暂无闪卡。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {libraryCards.map((card) => (
              <li key={card.id} className="flex items-start justify-between gap-2 rounded border border-stone-200 dark:border-stone-800 bg-white p-2.5">
                <div className="min-w-0">
                  <div className="break-words text-xs leading-5 text-stone-700 dark:text-stone-300">
                    <MarkdownSnippet text={card.front} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-stone-400">{formatDue(card.due)} · 已复习 {card.reps} 次</p>
                </div>
                <button
                  type="button"
                  onClick={() => flashcardStore.remove(card.id)}
                  aria-label={`删除闪卡"${card.front}"`}
                  className="shrink-0 rounded p-1 text-stone-300 dark:text-stone-600 hover:bg-red-50 hover:text-red-600"
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
  onFocus,
  onMaster,
  onDelete,
  onFocusTerm,
  onMasterTerm,
  onExportAnki = null,
  onExportObsidian = null,
  isStale,
  flashcardSignal = 0,
  // 左侧原文标记点击后驱动面板定位：{ id, nonce }，nonce 变化即可重复触发同一条
  panelFocus = null,
}) {
  const [activeTab, setActiveTab] = useState('explanations');
  const listRef = useRef(null);
  const panelRef = useRef(null);

  // 外部触发“生成闪卡”时自动切到闪卡页：渲染期跟随 prop 调整状态，避免用 effect 同步 setState
  const [prevFlashcardSignal, setPrevFlashcardSignal] = useState(flashcardSignal);
  if (flashcardSignal !== prevFlashcardSignal) {
    setPrevFlashcardSignal(flashcardSignal);
    if (flashcardSignal > 0) setActiveTab('flashcards');
  }

  const { cards: allCards, readAt } = useSyncExternalStore(subscribeFlashcards, getAllCardsSnapshot, getAllCardsSnapshot);
  const dueCount = useMemo(
    () => allCards.filter((card) => card.due <= readAt).length,
    [allCards, readAt]
  );

  const hasDemo = useMemo(() => explanations.some((record) => record.demo), [explanations]);
  // 词语层标记没有解读内容，解读页只列句子层记录；结构页才展示词语层
  const sentenceRecords = useMemo(
    () => explanations.filter((record) => record.level !== 'word'),
    [explanations]
  );
  const masteredCount = sentenceRecords.filter((record) => mastery[record.id]).length;

  const focusTerm = (termId) => {
    onFocusTerm?.(termId);
    if (listRef.current) listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 左→右双向定位：点击原文高亮/框线后切到能展示该记录的页签，滚动到对应卡片并短暂闪烁；
  // 页签切换与滚动都放在定时器里，先切页签等内容上屏再滚动，也避免 effect 体内同步 setState
  useEffect(() => {
    if (!panelFocus?.id) return undefined;
    const record = explanations.find((item) => item.id === panelFocus.id);
    const tabTimer = window.setTimeout(() => {
      if (!record) return;
      setActiveTab((current) => {
        if (record.level === 'word') return 'structure';
        return current === 'explanations' || current === 'structure' ? current : 'explanations';
      });
    }, 0);
    const scrollTimer = window.setTimeout(() => {
      const element = panelRef.current?.querySelector(`[data-panel-record-id="${CSS.escape(panelFocus.id)}"]`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.animate?.(
        [{ backgroundColor: '#ccfbf1' }, { backgroundColor: 'transparent' }],
        { duration: 900 }
      );
    }, 140);
    return () => {
      window.clearTimeout(tabTimer);
      window.clearTimeout(scrollTimer);
    };
  }, [panelFocus, explanations]);

  const renderTerms = () => (
    <div className="p-4" aria-label="白话列表">
      {terms.length === 0 ? (
        <p className="rounded border border-dashed border-stone-200 dark:border-stone-800 bg-white p-3 text-xs leading-5 text-stone-500">
          还没有生成白话。选中原文后使用「生成白话」。
        </p>
      ) : (
        <ul className="space-y-3">
          {terms.map((term) => {
            const mastered = term.status === 'mastered';
            const aliasList = Array.isArray(term.aliases) ? term.aliases : [];
            const stale = isStale?.(term, document?.content);
            return (
              <li
                key={term.id}
                data-panel-record-id={term.id}
                onClick={() => focusTerm(term.id)}
                title="点击定位原文"
                className="cursor-pointer rounded border border-stone-200 dark:border-stone-800 bg-white p-3 shadow-sm transition-colors hover:border-stone-300 dark:border-stone-700"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-stone-800 dark:text-stone-200">
                    {term.term || term.name}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {stale && (
                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                        源文已变化
                      </span>
                    )}
                    {onMasterTerm && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onMasterTerm(term);
                        }}
                        aria-pressed={mastered}
                        aria-label={mastered ? '取消懂了' : '标记为懂了'}
                        title={mastered ? '已懂（点击取消）' : '懂了'}
                        className={`flex h-5 w-5 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-stone-950 dark:ring-stone-100 ${
                          mastered
                            ? 'bg-stone-200 dark:bg-white/15 text-stone-950 dark:text-stone-100'
                            : 'text-stone-400 hover:bg-stone-200 dark:hover:bg-white/15 hover:text-stone-950 dark:text-stone-100'
                        }`}
                      >
                        <Check size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 break-words text-xs leading-5 text-stone-600 dark:text-stone-400">
                  <MarkdownSnippet text={term.explanation} />
                </div>
                {aliasList.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {aliasList.map((alias) => (
                      <span key={alias} className="rounded bg-stone-50 dark:bg-white/5 px-1.5 py-0.5 text-[10px] text-stone-500">
                        {alias}
                      </span>
                    ))}
                  </div>
                )}
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
      {sentenceRecords.length === 0 ? (
        <p className="rounded border border-dashed border-stone-200 dark:border-stone-800 bg-white p-3 text-xs leading-5 text-stone-500">
          还没有解读记录。选中原文后使用「解释这段」。
        </p>
      ) : (
        <ul className="space-y-3">
          {sentenceRecords.map((record) => {
            const stale = isStale?.(record, document?.content);
            return (
            <li
              key={record.id}
              data-panel-record-id={record.id}
              onClick={() => onFocus?.(record.id)}
              title="点击定位原文"
              className="cursor-pointer rounded border border-stone-200 dark:border-stone-800 bg-white p-3 shadow-sm transition-colors hover:border-stone-300 dark:border-stone-700"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span className="rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {roleLabel(record)}
                  </span>
                  {stale && (
                    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                      源文已变化
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMaster?.(record.id);
                    }}
                    aria-pressed={Boolean(mastery[record.id])}
                    aria-label={mastery[record.id] ? '取消懂了' : '标记为懂了'}
                    title={mastery[record.id] ? '已懂（点击取消）' : '懂了'}
                    className={`flex h-5 w-5 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-stone-950 dark:ring-stone-100 ${
                      mastery[record.id]
                        ? 'bg-stone-200 dark:bg-white/15 text-stone-950 dark:text-stone-100'
                        : 'text-stone-400 hover:bg-stone-200 dark:hover:bg-white/15 hover:text-stone-950 dark:text-stone-100'
                    }`}
                  >
                    <Check size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete?.(record.id);
                    }}
                    aria-label="删除解读"
                    title="删除解读"
                    className="flex h-5 w-5 items-center justify-center rounded text-stone-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="mt-2 break-words text-xs font-medium leading-5 text-stone-800 dark:text-stone-200">
                <MarkdownSnippet text={record.selectedText} />
              </div>
              <MarkdownSnippet
                text={record.explanation?.summary || record.explanation?.display || record.explanation?.plainExplanation || ''}
                className="mt-2 text-xs leading-5 text-stone-600 dark:text-stone-400"
              />
              <MarkdownSnippet
                text={record.explanation?.context || ''}
                className="mt-2 text-xs leading-5 text-stone-500"
              />
              <p className="mt-2 text-[11px] text-stone-400">
                {formatDate(record.createdAt)}
                {demoLabel(record) ? ` · ${demoLabel(record)}` : ''}
                {record.source === 'api' ? ' · AI 解读' : ''}
              </p>
            </li>
            );
          })}
        </ul>
      )}
      {sentenceRecords.length > 0 && (
        <p className="mt-4 text-center text-[11px] text-stone-400">
          已懂 {masteredCount}/{sentenceRecords.length} 条 · 「懂了」只影响你的复习清单，不会删除解读。
        </p>
      )}
    </div>
  );

  // 结构页：按文章层/段落层/句子层/词语层分组，serves 关系以嵌套列表呈现支撑结构；
  // 子级与父级左对齐，不做缩进，层级只靠分组嵌套表达
  const renderStructureRecord = (record, byId) => {
    const children = explanations.filter(
      (item) => item.level !== 'word' && item.servesTo === record.id && byId.has(record.id)
    );
    return (
      <li key={record.id}>
        <button
          type="button"
          data-panel-record-id={record.id}
          onClick={() => onFocus?.(record.id, { openCard: false })}
          title="点击定位原文"
          className="w-full rounded border border-stone-200 dark:border-stone-800 bg-white px-2.5 py-2 text-left transition-colors hover:border-stone-300 dark:border-stone-700"
        >
          <span className="mr-1.5 rounded bg-stone-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] text-stone-600 dark:text-stone-400">
            {roleLabel(record)}
          </span>
          <MarkdownSnippet text={record.selectedText} className="inline align-middle text-xs leading-5 text-stone-800 dark:text-stone-200" />
        </button>
        {children.length > 0 && (
          <ul className="mt-1.5 space-y-1.5">
            {children.map((child) => renderStructureRecord(child, byId))}
          </ul>
        )}
      </li>
    );
  };

  const renderStructure = () => {
    const byId = new Map(explanations.map((record) => [record.id, record]));
    const wordRecords = explanations.filter((record) => record.level === 'word');
    const topRecords = sentenceRecords.filter((record) => readerRoleLayer(record.role) !== 'sentence');
    // 未挂靠的句子重点：没有 serves，或服务对象已不存在
    const looseSentence = sentenceRecords.filter((record) =>
      readerRoleLayer(record.role) === 'sentence' && (!record.servesTo || !byId.has(record.servesTo))
    );
    if (explanations.length === 0) {
      return (
        <div className="p-4">
          <p className="rounded border border-dashed border-stone-200 dark:border-stone-800 bg-white p-3 text-xs leading-5 text-stone-500">
            还没有重点。点击顶栏「生成」里的「生成重点」或「生成解读」，AI 会按文章/段落/句子/词语分层标注原文。
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-4 p-4" aria-label="重点结构">
        {STRUCTURE_LAYER_SECTIONS.map((section) => {
          const records = topRecords.filter((record) => readerRoleLayer(record.role) === section.layer);
          if (records.length === 0) return null;
          return (
            <section key={section.layer}>
              <h3 className={`mb-2 inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${section.chip}`}>
                {section.label}
              </h3>
              <ul className="space-y-1.5">
                {records.map((record) => renderStructureRecord(record, byId))}
              </ul>
            </section>
          );
        })}
        {looseSentence.length > 0 && (
          <section>
            <h3 className="mb-2 inline-block rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
              句子层 · 句重点
            </h3>
            <ul className="space-y-1.5">
              {looseSentence.map((record) => renderStructureRecord(record, byId))}
            </ul>
          </section>
        )}
        {wordRecords.length > 0 && (
          <section>
            <h3 className="mb-2 inline-block rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
              词语层 · 中心/金句/成语
            </h3>
            <ul className="space-y-1.5">
              {wordRecords.map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    data-panel-record-id={record.id}
                    onClick={() => onFocus?.(record.id, { openCard: false })}
                    title="点击定位原文"
                    className={`w-full rounded border bg-white px-2.5 py-2 text-left transition-colors ${
                      record.markKind === 'idiom'
                        ? 'border-dashed border-red-200 hover:border-red-300'
                        : 'border-red-200 hover:border-red-300'
                    }`}
                  >
                    <span className="mr-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">
                      {MARK_KIND_LABELS[record.markKind] || '服务中心'}
                    </span>
                    <MarkdownSnippet text={record.selectedText} className="inline align-middle text-xs leading-5 text-stone-800 dark:text-stone-200" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  };

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col bg-[#fafafa]">
      <div className="border-b border-stone-200 dark:border-stone-800 bg-white">
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
                  ? 'border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100'
                  : 'border-transparent text-stone-400 hover:text-stone-700 dark:text-stone-300'
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
      {activeTab === 'structure' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {renderStructure()}
        </div>
      )}
      {activeTab === 'explanations' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {renderExplanations()}
          </div>
          {/* 导出就近放在解读 tab：与闪卡 tab 的 Anki 导出同构 */}
          {onExportObsidian && (
            <div className="shrink-0 border-t border-stone-100 dark:border-stone-800 px-2 py-1.5">
              <button
                type="button"
                onClick={onExportObsidian}
                disabled={explanations.length === 0}
                className="flex items-center gap-1.5 text-[11px] text-stone-500 outline-none hover:text-stone-900 dark:text-stone-100 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-40"
              >
                <NotebookText size={12} aria-hidden="true" />
                导出 Obsidian
              </button>
            </div>
          )}
        </div>
      )}
      {activeTab === 'flashcards' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FlashcardQuiz documentId={documentId} onExportAnki={onExportAnki} />
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
