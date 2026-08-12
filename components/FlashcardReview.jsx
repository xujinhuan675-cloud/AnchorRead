'use client';

import { useCallback, useState } from 'react';
import { flashcardStore } from '@/lib/flashcard-store';
import { RATING, RATING_LABELS, formatDue } from '@/lib/fsrs';

/** 评分按钮样式 */
const RATING_STYLES = {
  [RATING.AGAIN]: 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100',
  [RATING.HARD]: 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100',
  [RATING.GOOD]: 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100',
  [RATING.EASY]: 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100',
};

/**
 * 闪卡复习弹窗
 * 提供到期卡片的翻卡复习（FSRS 评分）与卡片库管理
 */
export default function FlashcardReview({ isOpen, onClose, onStatsChanged }) {
  if (!isOpen) return null;

  return (
    <FlashcardReviewContent
      onClose={onClose}
      onStatsChanged={onStatsChanged}
    />
  );
}

function FlashcardReviewContent({ onClose, onStatsChanged }) {
  const [queue] = useState(() => flashcardStore.getDueCards());
  const [tab, setTab] = useState(() =>
    queue.length > 0 ? 'review' : 'library'
  ); // review | library
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [stats, setStats] = useState(() => flashcardStore.getStats());
  const [allCards, setAllCards] = useState(() => flashcardStore.getAll());

  /** 刷新统计数据与卡片库列表 */
  const refresh = useCallback(() => {
    setStats(flashcardStore.getStats());
    setAllCards(flashcardStore.getAll());
    onStatsChanged?.();
  }, [onStatsChanged]);

  const currentCard = queue[currentIndex];
  const sessionDone = queue.length === 0 || currentIndex >= queue.length;

  /** 对当前卡片评分并进入下一张 */
  const handleRate = (rating) => {
    if (!currentCard) return;
    flashcardStore.review(currentCard.id, rating);
    setSessionReviewed((count) => count + 1);
    setFlipped(false);
    setCurrentIndex((index) => index + 1);
    refresh();
  };

  /** 删除卡片 */
  const handleDelete = (id) => {
    flashcardStore.remove(id);
    refresh();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]">
        {/* 弹窗头部 */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h2 className="text-lg font-semibold text-gray-900">闪卡复习</h2>
            <div className="flex text-xs border border-gray-200 rounded overflow-hidden">
              <button
                onClick={() => setTab('review')}
                className={`px-3 py-1.5 transition-colors ${
                  tab === 'review'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                复习{stats.due > 0 ? `（${stats.due} 张到期）` : ''}
              </button>
              <button
                onClick={() => setTab('library')}
                className={`px-3 py-1.5 transition-colors ${
                  tab === 'library'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                卡片库（{stats.total}）
              </button>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* 统计条 */}
        <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex items-center space-x-6 text-xs text-gray-500">
          <span>
            本次已复习 <b className="text-gray-800">{sessionReviewed}</b>
          </span>
          <span>
            今日已复习 <b className="text-gray-800">{stats.reviewedToday}</b>
          </span>
          <span>
            剩余待复习 <b className="text-gray-800">{Math.max(queue.length - currentIndex, 0)}</b>
          </span>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-6">
          {tab === 'review' && (
            <>
              {sessionDone ? (
                /* 本轮复习完成 */
                <div className="text-center py-12">
                  <div className="text-4xl mb-3">🎉</div>
                  <p className="text-gray-700 font-medium">
                    {queue.length === 0
                      ? '当前没有到期的卡片'
                      : '本轮复习完成！'}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    {queue.length === 0
                      ? '可以在「文章理解」中生成新的记忆卡片，或稍后再来'
                      : `共复习 ${sessionReviewed} 张卡片，FSRS 已为你安排好下次复习时间`}
                  </p>
                </div>
              ) : (
                /* 翻卡复习 */
                <div className="flex flex-col items-center">
                  <div
                    onClick={() => setFlipped(true)}
                    className={`w-full min-h-[220px] rounded-lg border-2 p-6 flex flex-col justify-center ${
                      flipped
                        ? 'border-green-300 bg-green-50 cursor-default'
                        : 'border-gray-300 bg-white cursor-pointer hover:border-blue-400 transition-colors'
                    }`}
                  >
                    <p className="text-xs text-gray-400 mb-3">
                      {flipped ? '答案' : '问题'}
                      {currentCard.articleTitle && (
                        <span className="ml-2">来自：{currentCard.articleTitle}</span>
                      )}
                    </p>
                    <p className="text-base text-gray-900 leading-relaxed whitespace-pre-wrap">
                      {flipped ? currentCard.back : currentCard.front}
                    </p>
                    {flipped && currentCard.source && (
                      <p className="text-xs text-gray-400 mt-4 border-t border-green-200 pt-3 leading-5">
                        原文依据：{currentCard.source}
                      </p>
                    )}
                  </div>

                  {!flipped ? (
                    <button
                      onClick={() => setFlipped(true)}
                      className="mt-4 px-6 py-2 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition-colors"
                    >
                      显示答案
                    </button>
                  ) : (
                    /* FSRS 评分按钮 */
                    <div className="mt-4 grid grid-cols-4 gap-2 w-full">
                      {[RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY].map(
                        (rating) => (
                          <button
                            key={rating}
                            onClick={() => handleRate(rating)}
                            className={`px-3 py-2 text-sm font-medium border rounded transition-colors ${RATING_STYLES[rating]}`}
                          >
                            {RATING_LABELS[rating]}
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {tab === 'library' && (
            <>
              {allCards.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-12">
                  卡片库为空，去「文章理解」生成第一批记忆卡片吧
                </p>
              ) : (
                <div className="space-y-2">
                  {allCards.map((card) => (
                    <div
                      key={card.id}
                      className="border border-gray-200 rounded p-3 text-xs flex items-start justify-between space-x-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-gray-800 font-medium leading-5">
                          {card.front}
                        </p>
                        <p className="text-gray-500 mt-1 leading-5">{card.back}</p>
                        <p className="text-gray-300 mt-1">
                          {card.articleTitle || '未命名文章'} ·{' '}
                          {card.reps > 0 ? `已复习 ${card.reps} 次` : '未复习'} ·{' '}
                          {card.due > 0 ? formatDue(card.due) : '待学习'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDelete(card.id)}
                        className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                        title="删除卡片"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
