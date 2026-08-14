/**
 * FSRS 间隔重复调度算法（FSRS-5 轻量实现）
 * 与 HiNote 闪卡系统同源思路：依据记忆稳定性与提取难度安排下次复习时间
 */

// FSRS-5 官方默认参数
const W = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.533,
  0.167, 1.0, 1.9395, 0.11, 0.29, 2.18, 0.51, 2.94, 0.45, 0.77,
];

const DECAY = -0.5;
const FACTOR = 19 / 81;

// 期望记忆保持率：复习时仍有 90% 概率记得
const DESIRED_RETENTION = 0.9;

// 学习阶段短间隔（毫秒）
const LEARNING_STEP_AGAIN = 10 * 60 * 1000; // 忘记：10 分钟后再看
const LEARNING_STEP_HARD = 30 * 60 * 1000; // 困难：30 分钟后再看

/** 评分等级 */
export const RATING = {
  AGAIN: 1, // 完全忘记
  HARD: 2, // 想起来很吃力
  GOOD: 3, // 正常想起
  EASY: 4, // 轻而易举
};

export const RATING_LABELS = {
  [RATING.AGAIN]: '忘记',
  [RATING.HARD]: '困难',
  [RATING.GOOD]: '记得',
  [RATING.EASY]: '轻松',
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** 新卡初始稳定性（按评分取对应参数） */
function initStability(rating) {
  return Math.max(W[rating - 1], 0.1);
}

/** 新卡初始难度 */
function initDifficulty(rating) {
  return clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10);
}

/** 提取强度：距上次复习 elapsedDays 天后仍能记起的概率 */
function retrievability(elapsedDays, stability) {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

/** 由稳定性反推达到期望保持率的间隔天数 */
function nextInterval(stability) {
  const interval = (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
  return Math.max(1, Math.round(interval));
}

/** 复习后更新难度（带向均值回归） */
function nextDifficulty(difficulty, rating) {
  const delta = difficulty - W[6] * (rating - 3);
  const reverted = W[7] * initDifficulty(RATING.GOOD) + (1 - W[7]) * delta;
  return clamp(reverted, 1, 10);
}

/** 成功回忆后的新稳定性 */
function recallStability(difficulty, stability, r, rating) {
  const hardPenalty = rating === RATING.HARD ? W[15] : 1;
  const easyBonus = rating === RATING.EASY ? W[16] : 1;
  const inner =
    Math.exp(W[8]) *
    (11 - difficulty) *
    Math.pow(stability, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(stability * (inner + 1), 0.1);
}

/** 忘记后的新稳定性 */
function forgetStability(difficulty, stability, r) {
  const value =
    W[11] *
    Math.pow(difficulty, -W[12]) *
    (Math.pow(stability + 1, W[13]) - 1) *
    Math.exp(W[14] * (1 - r));
  return clamp(value, 0.1, stability);
}

/**
 * 创建一张新卡片
 * @param {Object} opts - { front, back, source, articleTitle }
 */
export function createCard({ front, back, source = '', articleTitle = '', documentId = '' }) {
  return {
    id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    front,
    back,
    source,
    articleTitle,
    documentId,
    state: 'new', // new | learning | review
    reps: 0,
    lapses: 0,
    stability: 0,
    difficulty: 0,
    due: 0, // 到期时间戳，0 表示立即可学
    lastReview: 0,
    createdAt: Date.now(),
  };
}

/**
 * 复习一张卡片并计算下次到期时间
 * @param {Object} card - 卡片对象
 * @param {number} rating - RATING 之一
 * @param {number} now - 当前时间戳
 * @returns {Object} 更新后的卡片（新对象）
 */
export function reviewCard(card, rating, now = Date.now()) {
  const elapsedDays = card.lastReview > 0 ? (now - card.lastReview) / 86400000 : 0;

  let { stability, difficulty, lapses } = card;
  let state = card.state;

  if (card.state === 'new' || card.reps === 0) {
    // 首次学习
    stability = initStability(rating);
    difficulty = initDifficulty(rating);
  } else {
    const r = retrievability(elapsedDays, Math.max(stability, 0.1));
    difficulty = nextDifficulty(difficulty, rating);
    if (rating === RATING.AGAIN) {
      stability = forgetStability(difficulty, stability, r);
    } else {
      stability = recallStability(difficulty, stability, r, rating);
    }
  }

  if (rating === RATING.AGAIN) {
    lapses += 1;
  }

  // 计算下次到期时间
  let due;
  if (rating === RATING.AGAIN) {
    state = 'learning';
    due = now + LEARNING_STEP_AGAIN;
  } else if (rating === RATING.HARD && card.reps < 2) {
    state = 'learning';
    due = now + LEARNING_STEP_HARD;
  } else {
    state = 'review';
    due = now + nextInterval(stability) * 86400000;
  }

  return {
    ...card,
    state,
    reps: card.reps + 1,
    lapses,
    stability,
    difficulty,
    due,
    lastReview: now,
  };
}

/**
 * 格式化剩余时间，用于界面展示
 * @param {number} due - 到期时间戳
 * @param {number} now - 当前时间戳
 */
export function formatDue(due, now = Date.now()) {
  const diff = due - now;
  if (diff <= 0) return '已到期';
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.round(hours / 24);
  return `${days} 天后`;
}
