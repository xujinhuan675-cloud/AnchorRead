/**
 * 闪卡导出 Anki
 * 生成 Anki「文件导入」兼容的制表符分隔文本：
 * 第 1 列正面、第 2 列背面、第 3 列标签（#tags column:3 声明）
 */

export const ANKI_EXPORT_TAG = 'AnchorRead';

/** Anki 标签不允许空格，统一转为下划线并剔除特殊字符 */
export function sanitizeAnkiTag(value) {
  return String(value || '')
    .trim()
    .replace(/[\s/\\]+/gu, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 60);
}

/** 字段内的制表符与换行转为 Anki 可渲染的形式（html:true 模式下换行用 <br>） */
function normalizeField(value) {
  return String(value || '')
    .replace(/\t/gu, ' ')
    .replace(/\r?\n/gu, '<br>')
    .trim();
}

/**
 * 构建 Anki 导入文本
 * @param {Array<{front, back, articleTitle?, source?}>} cards - 闪卡列表
 * @param {{includeTags?: boolean}} [options]
 * @returns {string} 可直接导入 Anki 的文本内容
 */
export function buildAnkiText(cards, { includeTags = true } = {}) {
  const rows = (Array.isArray(cards) ? cards : [])
    .filter((card) => card && String(card.front || '').trim() && String(card.back || '').trim())
    .map((card) => {
      const fields = [normalizeField(card.front), normalizeField(card.back)];
      if (includeTags) {
        const docTag = sanitizeAnkiTag(card.articleTitle);
        fields.push([ANKI_EXPORT_TAG, docTag].filter(Boolean).join(' '));
      }
      return fields.join('\t');
    });

  const header = ['#separator:tab', '#html:true'];
  if (includeTags) header.push('#tags column:3');
  return `${header.join('\n')}\n${rows.join('\n')}\n`;
}

/**
 * 浏览器端下载 Anki 导入文件（.txt，Anki 文件导入入口可直接选择）
 */
export function downloadAnkiFile(text, filename = 'anchor-read-flashcards.txt') {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
