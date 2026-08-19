'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Brain, Check, Eye, GraduationCap, NotebookText, Trash2, X } from 'lucide-react';
import { flashcardStore } from '@/lib/flashcard-store';
import { formatDue, RATING } from '@/lib/fsrs';
import { readerRoleLayer } from '@/lib/reader-analysis';
import { useLocale } from '@/components/LocaleProvider';
import MarkdownSnippet from './MarkdownSnippet';

const TABS = [
  { id: 'explanations', labelKey: 'panel.tab.explanations' },
  { id: 'structure', labelKey: 'panel.tab.structure' },
  { id: 'terms', labelKey: 'panel.tab.terms' },
  { id: 'flashcards', labelKey: 'panel.tab.flashcards' },
];

const RATING_STYLES = {
  [RATING.AGAIN]: 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40',
  [RATING.HARD]: 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950/40',
  [RATING.GOOD]: 'border-stone-200 dark:border-stone-700 text-stone-950 dark:text-stone-100 hover:bg-stone-100 dark:bg-white/10',
  [RATING.EASY]: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40',
};

// 评分按钮文案键化后按 rating 数值映射到面板域键
const RATING_KEY_BY_VALUE = {
  [RATING.AGAIN]: 'panel.rating.again',
  [RATING.HARD]: 'panel.rating.hard',
  [RATING.GOOD]: 'panel.rating.good',
  [RATING.EASY]: 'panel.rating.easy',
};

// 角色文案走 i18n：键名与 record.role 值对应，未登记角色回退默认键
function roleLabelKey(record) {
  return record?.role ? `panel.role.${record.role}` : 'panel.role.default';
}

const STRUCTURE_LAYER_SECTIONS = [
  { layer: 'article', labelKey: 'workspace.layer.article', chip: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300' },
  { layer: 'paragraph', labelKey: 'workspace.layer.paragraph', chip: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300' },
];
const MARK_KIND_LABEL_KEYS = { center: 'panel.mark.center', quote: 'panel.mark.quote', idiom: 'panel.mark.idiom' };

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

function demoLabelKey(record) {
  if (record.demo) return 'panel.demoLabel';
  if (record.batchAnalysis) return 'panel.batchLabel';
  return '';
}

function FlashcardQuiz({ documentId, onExportAnki = null }) {
  const { t } = useLocale();
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
      <div className="mx-auto mt-6 w-full max-w-sm rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-900 dark:bg-emerald-950/40">
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{t('panel.quizDoneTitle')}</p>
        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">{t('panel.quizDoneBody', { count: session.reviewed })}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={startSession} className="h-8 rounded border border-emerald-300 bg-white px-3 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-stone-900 dark:text-emerald-300 dark:hover:bg-emerald-950/60">
            {t('panel.quizAgain')}
          </button>
          <button type="button" onClick={() => setSession(null)} className="h-8 rounded border border-stone-200 dark:border-stone-800 bg-white px-3 text-xs font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:bg-white/5">
            {t('panel.quizBack')}
          </button>
        </div>
      </div>
    );
  }

  if (session) {
    const current = session.queue[session.index];
    return (
      <div className="p-4" aria-label={t('panel.flashAria')}>
        <div className="flex items-center justify-between text-[11px] text-stone-400">
          <span>{t('panel.quizProgress', { index: session.index + 1, total: session.queue.length, reviewed: session.reviewed })}</span>
          <span className="flex items-center gap-3">
            <button type="button" onClick={handleSkip} className="font-medium text-stone-500 hover:text-stone-800 dark:text-stone-200">{t('panel.quizSkip')}</button>
            <button type="button" onClick={() => setSession(null)} className="font-medium text-stone-500 hover:text-stone-800 dark:text-stone-200">{t('panel.quizExit')}</button>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSession({ ...session, revealed: true })}
          className="mt-3 flex min-h-32 w-full flex-col items-center justify-center rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 text-center transition-colors hover:border-stone-400 dark:hover:border-stone-500"
        >
          <p className="text-sm font-medium leading-6 text-stone-900 dark:text-stone-100">
            <MarkdownSnippet text={current.front} />
          </p>
          {!session.revealed && <span className="mt-3 text-xs text-stone-400">{t('panel.quizRevealHint')}</span>}
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
                  {t(RATING_KEY_BY_VALUE[rating])}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-4" aria-label={t('panel.flashAria')}>
      <div className="flex items-center justify-between text-xs text-stone-600 dark:text-stone-400">
        <span>{t('panel.flashStats', { due: stats.due, total: stats.total })}</span>
        <span className="text-stone-400">{t('panel.flashReviewedToday', { count: stats.reviewedToday })}</span>
      </div>
      <button
        type="button"
        onClick={startSession}
        disabled={stats.due === 0}
        className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded bg-stone-900 text-xs font-medium text-white outline-none hover:bg-stone-700 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300 dark:disabled:bg-white/15 dark:disabled:text-stone-500"
      >
        <Brain size={14} aria-hidden="true" />
        {stats.due > 0 ? t('panel.flashStart', { count: stats.due }) : t('panel.flashNoDue')}
      </button>
      {onExportAnki && (
        <button
          type="button"
          onClick={onExportAnki}
          disabled={stats.total === 0}
          className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-500 outline-none hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-40 dark:text-stone-400 dark:hover:text-stone-100"
        >
          <GraduationCap size={12} aria-hidden="true" />
          {t('panel.flashExportAnki')}
        </button>
      )}
      {stats.total === 0 && (
        <p className="mt-3 rounded border border-dashed border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 text-xs leading-5 text-stone-500">
          {t('panel.flashEmptyHint')}
        </p>
      )}

      <button
        type="button"
        onClick={() => setLibraryOpen((open) => !open)}
        aria-expanded={libraryOpen}
        className="mt-4 flex w-full items-center justify-between text-xs font-medium text-stone-500 hover:text-stone-800 dark:text-stone-200"
      >
        {t('panel.flashLibrary', { count: libraryCards.length })}
        <Eye size={13} aria-hidden="true" />
      </button>
      {libraryOpen && (
        libraryCards.length === 0 ? (
          <p className="mt-2 text-xs text-stone-400">{t('panel.flashLibraryEmpty')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {libraryCards.map((card) => (
              <li key={card.id} className="flex items-start justify-between gap-2 rounded border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-2.5">
                <div className="min-w-0">
                  <div className="break-words text-xs leading-5 text-stone-700 dark:text-stone-300">
                    <MarkdownSnippet text={card.front} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-stone-400">{t('panel.flashDueInfo', { due: formatDue(card.due), reps: card.reps })}</p>
                </div>
                <button
                  type="button"
                  onClick={() => flashcardStore.remove(card.id)}
                  aria-label={t('panel.flashDeleteAria', { front: card.front })}
                  className="shrink-0 rounded p-1 text-stone-300 dark:text-stone-600 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
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
  onDeleteTerm,
  onExportAnki = null,
  onExportObsidian = null,
  isStale,
  flashcardSignal = 0,
  // 左侧原文标记点击后驱动面板定位：{ id, nonce }，nonce 变化即可重复触发同一条
  panelFocus = null,
  closeSlot = null,
}) {
  const { t, locale } = useLocale();
  const [activeTab, setActiveTab] = useState('explanations');
  const listRef = useRef(null);
  // 白话列表独立滚动容器：内容滚动时页签行固定置顶（与解读/重点/闪卡页同构）
  const termsListRef = useRef(null);
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
    if (termsListRef.current) termsListRef.current.scrollTo({ top: 0, behavior: 'smooth' });
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
    <div className="p-4" aria-label={t('panel.termsAria')}>
      {terms.length === 0 ? (
        <p className="rounded border border-dashed border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 text-xs leading-5 text-stone-500">
          {t('panel.termsEmpty')}
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
                title={t('panel.locateTitle')}
                className="cursor-pointer rounded border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 shadow-sm transition-colors hover:border-stone-300 dark:hover:border-stone-600"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-stone-800 dark:text-stone-200">
                    {term.term || term.name}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {stale && (
                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                        {t('panel.staleBadge')}
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
                        aria-label={mastered ? t('reader.unmarkMastered') : t('reader.markMastered')}
                        title={mastered ? t('reader.masteredTitle') : t('reader.masterTitle')}
                        className={`flex h-5 w-5 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-stone-950 dark:focus-visible:ring-stone-100 ${
                          mastered
                            ? 'bg-stone-200 dark:bg-white/15 text-stone-950 dark:text-stone-100'
                            : 'text-stone-400 hover:bg-stone-200 dark:hover:bg-white/15 hover:text-stone-950 dark:text-stone-100'
                        }`}
                      >
                        <Check size={12} aria-hidden="true" />
                      </button>
                    )}
                    {onDeleteTerm && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteTerm(term);
                        }}
                        aria-label={t('panel.deleteTerm')}
                        title={t('panel.deleteTerm')}
                        className="flex h-5 w-5 items-center justify-center rounded text-stone-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500"
                      >
                        <X size={12} aria-hidden="true" />
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
    <div className="p-4" aria-label={t('panel.explanationsAria')}>
      {hasDemo && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {t('panel.demoNotice')}
        </p>
      )}
      {sentenceRecords.length === 0 ? (
        <p className="rounded border border-dashed border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 text-xs leading-5 text-stone-500">
          {t('panel.explanationsEmpty')}
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
              title={t('panel.locateTitle')}
              className="cursor-pointer rounded border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 shadow-sm transition-colors hover:border-stone-300 dark:hover:border-stone-600"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span className="rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-stone-100 dark:text-stone-900">
                    {t(roleLabelKey(record))}
                  </span>
                  {stale && (
                    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                      {t('panel.staleBadge')}
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
                    aria-label={mastery[record.id] ? t('reader.unmarkMastered') : t('reader.markMastered')}
                    title={mastery[record.id] ? t('reader.masteredTitle') : t('reader.masterTitle')}
                    className={`flex h-5 w-5 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-stone-950 dark:focus-visible:ring-stone-100 ${
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
                    aria-label={t('panel.deleteExplanation')}
                    title={t('panel.deleteExplanation')}
                    className="flex h-5 w-5 items-center justify-center rounded text-stone-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
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
                {formatDate(record.createdAt, locale)}
                {demoLabelKey(record) ? ` · ${t(demoLabelKey(record))}` : ''}
                {record.source === 'api' ? ` · ${t('panel.aiSource')}` : ''}
              </p>
            </li>
            );
          })}
        </ul>
      )}
      {sentenceRecords.length > 0 && (
        <p className="mt-4 text-center text-[11px] text-stone-400">
          {t('panel.masteredSummary', { mastered: masteredCount, total: sentenceRecords.length })}
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
          title={t('panel.locateTitle')}
          className="w-full rounded border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-2.5 py-2 text-left transition-colors hover:border-stone-300 dark:hover:border-stone-600"
        >
          <span className="mr-1.5 rounded bg-stone-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] text-stone-600 dark:text-stone-400">
            {t(roleLabelKey(record))}
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
          <p className="rounded border border-dashed border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 text-xs leading-5 text-stone-500">
            {t('panel.structureEmpty')}
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-4 p-4" aria-label={t('panel.structureAria')}>
        {STRUCTURE_LAYER_SECTIONS.map((section) => {
          const records = topRecords.filter((record) => readerRoleLayer(record.role) === section.layer);
          if (records.length === 0) return null;
          return (
            <section key={section.layer}>
              <h3 className={`mb-2 inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${section.chip}`}>
                {t(section.labelKey)}
              </h3>
              <ul className="space-y-1.5">
                {records.map((record) => renderStructureRecord(record, byId))}
              </ul>
            </section>
          );
        })}
        {looseSentence.length > 0 && (
          <section>
            <h3 className="mb-2 inline-block rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              {t('workspace.layer.sentence')}
            </h3>
            <ul className="space-y-1.5">
              {looseSentence.map((record) => renderStructureRecord(record, byId))}
            </ul>
          </section>
        )}
        {wordRecords.length > 0 && (
          <section>
            <h3 className="mb-2 inline-block rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
              {t('workspace.layer.word')}
            </h3>
            <ul className="space-y-1.5">
              {wordRecords.map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    data-panel-record-id={record.id}
                    onClick={() => onFocus?.(record.id, { openCard: false })}
                    title={t('panel.locateTitle')}
                    className={`w-full rounded border bg-white dark:bg-stone-900 px-2.5 py-2 text-left transition-colors ${
                      record.markKind === 'idiom'
                        ? 'border-dashed border-red-200 hover:border-red-300 dark:border-red-900 dark:hover:border-red-700'
                        : 'border-red-200 hover:border-red-300 dark:border-red-900 dark:hover:border-red-700'
                    }`}
                  >
                    <span className="mr-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 dark:bg-red-950 dark:text-red-300">
                      {t(MARK_KIND_LABEL_KEYS[record.markKind] || 'panel.mark.center')}
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
    <div ref={panelRef} className="flex h-full min-h-0 flex-col bg-[#fafafa] dark:bg-stone-950">
      <div className="border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        {/* 窄屏 Sheet 形态下关闭按钮经 closeSlot 内联进页签行尾部：构造上不与页签重叠 */}
        <div className="flex items-stretch">
          <div className="flex flex-1" role="tablist" aria-label={t('panel.tabsAria')}>
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
                    : 'border-transparent text-stone-400 hover:text-stone-700 dark:text-stone-300 dark:hover:text-stone-100'
                }`}
              >
                {t(tab.labelKey)}
                {tab.id === 'flashcards' && dueCount > 0 && (
                  <span className="absolute right-1 top-1 min-w-[15px] rounded-full bg-red-500 px-1 text-center text-[9px] leading-[15px] text-white">
                    {dueCount > 99 ? '99+' : dueCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          {closeSlot}
        </div>
      </div>

      {activeTab === 'terms' && (
        <div ref={termsListRef} className="min-h-0 flex-1 overflow-y-auto">
          {renderTerms()}
        </div>
      )}
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
                className="flex items-center gap-1.5 text-[11px] text-stone-500 outline-none hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-40 dark:text-stone-400 dark:hover:text-stone-100"
              >
                <NotebookText size={12} aria-hidden="true" />
                {t('panel.exportObsidian')}
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

function formatDate(value, locale = 'zh-CN') {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
