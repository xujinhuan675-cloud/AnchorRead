/**
 * 溯源与生成指纹工具
 * 为文档与衍生内容（解读/术语/图表）提供内容指纹，
 * 用于判断衍生内容是否因源文变化而过期，支撑"越用越准确"的增量失效与按需重算。
 */

const FINGERPRINT_PREFIX = 'fp:';

/**
 * 为原文内容生成稳定的文本指纹
 * 采用 FNV-1a 32 位哈希，风格对齐 explanation-store 的 hashText
 * 仅对原文做 trim，不压缩内部空白，保证内容真实变化都能被感知
 * @param {string} content - 原文内容
 * @returns {string} 形如 "fp:811c9dc5" 的指纹；空内容返回空串
 */
export function createSourceFingerprint(content) {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) return '';

  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${FINGERPRINT_PREFIX}${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * 判断衍生内容记录是否相对当前原文已过期
 * - 记录未携带指纹（旧数据）时返回 false，不视为过期，避免误报
 * - 记录指纹与当前原文指纹不一致即视为过期
 * @param {{ sourceFingerprint?: string }} record - 衍生内容记录
 * @param {string} currentContent - 当前原文内容
 * @returns {boolean}
 */
export function isDerivationStale(record, currentContent) {
  const fingerprint = record && typeof record.sourceFingerprint === 'string'
    ? record.sourceFingerprint
    : '';
  if (!fingerprint) return false;
  return fingerprint !== createSourceFingerprint(currentContent);
}
