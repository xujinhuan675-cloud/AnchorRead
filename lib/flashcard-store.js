/**
 * 闪卡存储管理（localStorage 持久化）
 * 负责卡片的增删查、到期筛选与复习结果落盘
 */

import { createCard, reviewCard } from './fsrs';

const STORAGE_KEY = 'smart-excalidraw-flashcards';

function isBrowser() {
  return typeof window !== 'undefined';
}

/** 读取全部卡片 */
function loadCards() {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to load flashcards:', error);
    return [];
  }
}

/** 写入全部卡片 */
function saveCards(cards) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
    // 通知其他组件（同页签）刷新徽标等状态
    window.dispatchEvent(new CustomEvent('flashcards-changed'));
  } catch (error) {
    console.error('Failed to save flashcards:', error);
  }
}

export const flashcardStore = {
  /** 获取全部卡片 */
  getAll() {
    return loadCards();
  },

  /**
   * 批量新增卡片
   * @param {Array<{front, back, source}>} items - AI 生成的原始卡片
   * @param {string} articleTitle - 来源文章标题
   * @returns {Array} 新建的卡片列表
   */
  addCards(items, articleTitle = '') {
    const existing = loadCards();
    // 去重：问题与来源文章均相同的卡片不再重复添加
    const existingKeys = new Set(
      existing.map((c) => `${c.articleTitle}||${c.front}`)
    );

    const created = [];
    for (const item of items || []) {
      if (!item || !item.front) continue;
      const key = `${articleTitle}||${item.front}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      created.push(
        createCard({
          front: item.front,
          back: item.back,
          source: item.source || '',
          articleTitle,
        })
      );
    }

    if (created.length > 0) {
      saveCards([...existing, ...created]);
    }
    return created;
  },

  /** 获取已到期（含新卡）的卡片，按到期时间升序 */
  getDueCards(now = Date.now()) {
    return loadCards()
      .filter((c) => c.due <= now)
      .sort((a, b) => a.due - b.due);
  },

  /** 获取到期卡片数量 */
  getDueCount(now = Date.now()) {
    return this.getDueCards(now).length;
  },

  /**
   * 记录一次复习
   * @param {string} id - 卡片 ID
   * @param {number} rating - FSRS 评分
   * @returns {Object|null} 更新后的卡片
   */
  review(id, rating) {
    const cards = loadCards();
    const index = cards.findIndex((c) => c.id === id);
    if (index === -1) return null;

    const updated = reviewCard(cards[index], rating);
    cards[index] = updated;
    saveCards(cards);
    return updated;
  },

  /** 删除单张卡片 */
  remove(id) {
    saveCards(loadCards().filter((c) => c.id !== id));
  },

  /** 清空全部卡片 */
  clear() {
    saveCards([]);
  },

  /** 统计信息：总数与今日已复习数 */
  getStats(now = Date.now()) {
    const cards = loadCards();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    return {
      total: cards.length,
      due: cards.filter((c) => c.due <= now).length,
      reviewedToday: cards.filter((c) => c.lastReview >= todayStart.getTime()).length,
    };
  },
};
