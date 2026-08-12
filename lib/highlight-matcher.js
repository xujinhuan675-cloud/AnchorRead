/**
 * 高亮定位匹配器
 * 将 AI 返回的重点片段在原文中逐字定位，产出供预览渲染的分段序列
 */

/**
 * 在原文中定位高亮片段
 * 处理 AI 输出与原文之间的轻微差异（首尾空白、换行差异）
 * @param {string} article - 原文
 * @param {Array<{text, level, reason}>} highlights - AI 返回的片段
 * @returns {Array} 定位成功的高亮，附带 start/end 区间
 */
export function locateHighlights(article, highlights) {
  if (!article || !Array.isArray(highlights)) return [];

  const located = [];
  for (const highlight of highlights) {
    const text = (highlight.text || '').trim();
    if (!text) continue;

    let start = article.indexOf(text);

    // 兜底：压缩空白后再匹配（处理换行/空格差异）
    if (start === -1) {
      const normalized = text.replace(/\s+/g, '');
      const mapping = buildWhitespaceMapping(article);
      const matchStart = mapping.normalized.indexOf(normalized);
      if (matchStart !== -1) {
        start = mapping.toOriginal[matchStart];
        const endOriginal = mapping.toOriginal[matchStart + normalized.length - 1];
        located.push({
          ...highlight,
          start,
          end: endOriginal + 1,
        });
        continue;
      }
      continue; // 两种策略都失败则丢弃该片段
    }

    located.push({ ...highlight, start, end: start + text.length });
  }

  // 按起始位置排序并剔除重叠片段（保留先出现的）
  located.sort((a, b) => a.start - b.start);
  const result = [];
  let lastEnd = -1;
  for (const item of located) {
    if (item.start >= lastEnd) {
      result.push(item);
      lastEnd = item.end;
    }
  }
  return result;
}

/**
 * 构建原文的空白压缩映射
 * @returns {{normalized: string, toOriginal: number[]}}
 *  normalized: 去除全部空白后的文本
 *  toOriginal: normalized 每个字符对应的原文下标
 */
function buildWhitespaceMapping(article) {
  let normalized = '';
  const toOriginal = [];
  for (let i = 0; i < article.length; i++) {
    const ch = article[i];
    if (!/\s/.test(ch)) {
      toOriginal.push(i);
      normalized += ch;
    }
  }
  return { normalized, toOriginal };
}

/**
 * 将原文切分为渲染分段
 * @param {string} article - 原文
 * @param {Array} located - locateHighlights 的返回值
 * @returns {Array<{text: string, highlight?: Object}>}
 *  普通段 highlight 为空，高亮段携带 level/reason 信息
 */
export function buildSegments(article, located) {
  if (!article) return [];
  if (!located || located.length === 0) {
    return [{ text: article }];
  }

  const segments = [];
  let cursor = 0;
  for (const item of located) {
    if (item.start > cursor) {
      segments.push({ text: article.slice(cursor, item.start) });
    }
    segments.push({
      text: article.slice(item.start, item.end),
      highlight: item,
    });
    cursor = item.end;
  }
  if (cursor < article.length) {
    segments.push({ text: article.slice(cursor) });
  }
  return segments;
}
