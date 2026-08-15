/**
 * 导出 Obsidian 兼容 Markdown 笔记
 * 每篇文档生成一份笔记：YAML frontmatter + 解读引用 + 术语双链 + 闪卡问答，
 * 术语使用 [[术语]] 双链，便于在 Obsidian 图谱中沉淀概念网络
 */

function yamlEscape(value) {
  return String(value || '').replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** 术语双链：剔除 Obsidian 双链语法中的破坏字符 */
function wikiLink(term) {
  return `[[${String(term || '').replace(/[[\]|#]/gu, '')}]]`;
}

/**
 * 为单篇文档构建 Obsidian 笔记
 * @param {Object} params
 * @param {{id, title, sourceType?, sourceUrl?}} params.document
 * @param {Array} [params.explanations] - 解读记录
 * @param {Array} [params.terms] - 术语记录
 * @param {Array} [params.flashcards] - 闪卡
 * @returns {{filename: string, content: string}}
 */
export function buildObsidianNote({ document, explanations = [], terms = [], flashcards = [], exportedAt = Date.now() } = {}) {
  if (!document?.id || !document?.title) {
    throw new Error('buildObsidianNote 需要带 id 与 title 的文档。');
  }

  const lines = [
    '---',
    `title: "${yamlEscape(document.title)}"`,
    `source_type: ${document.sourceType || 'unknown'}`,
    document.sourceUrl ? `source_url: "${yamlEscape(document.sourceUrl)}"` : null,
    `exported_at: ${formatDate(exportedAt)}`,
    'generator: AnchorRead',
    'tags: [anchorread]',
    '---',
    '',
    `# ${document.title}`,
    '',
  ].filter((line) => line !== null);

  if (explanations.length > 0) {
    lines.push(`## 解读（${explanations.length}）`, '');
    for (const record of explanations) {
      const quote = String(record.selectedText || '').trim();
      const plain = String(record.explanation?.plainExplanation || '').trim();
      if (!quote && !plain) continue;
      if (quote) lines.push(`> ${quote.split('\n').join('\n> ')}`);
      if (plain) lines.push('', plain);
      lines.push('');
    }
  }

  if (terms.length > 0) {
    lines.push(`## 术语（${terms.length}）`, '');
    for (const record of terms) {
      const name = String(record.term || '').trim();
      if (!name) continue;
      const aliases = Array.isArray(record.aliases) && record.aliases.length > 0
        ? `（别名：${record.aliases.join('、')}）`
        : '';
      const status = record.status === 'mastered' ? ' ✅ 已掌握' : '';
      const explanation = String(record.explanation || '').trim();
      lines.push(`- ${wikiLink(name)}${aliases}${status}`);
      if (explanation) lines.push(`  - ${explanation}`);
    }
    lines.push('');
  }

  if (flashcards.length > 0) {
    lines.push(`## 闪卡（${flashcards.length}）`, '');
    for (const card of flashcards) {
      const front = String(card.front || '').trim();
      const back = String(card.back || '').trim();
      if (!front) continue;
      lines.push(`- **问**：${front}`);
      if (back) lines.push(`  - **答**：${back}`);
    }
    lines.push('');
  }

  lines.push('> 由 Anchor Read 导出：读 → 懂 → 选 → 记。', '');

  const safeTitle = String(document.title)
    .replace(/[\\/:*?"<>|#^[\]]/gu, '')
    .trim()
    .slice(0, 80) || document.id;
  return { filename: `${safeTitle}.md`, content: lines.join('\n') };
}

/**
 * 为整个文档库构建 Obsidian 笔记集合
 * 只导出有派生内容（解读/术语/闪卡）的文档
 * @returns {Array<{filename, content}>}
 */
export function buildObsidianVaultNotes({ documents = [], explanations = [], terms = [], flashcards = [], exportedAt = Date.now() } = {}) {
  const notes = [];
  for (const document of documents) {
    const docExplanations = explanations.filter((r) => r.documentId === document.id);
    const docTerms = terms.filter((r) => r.documentId === document.id);
    const docCards = flashcards.filter((r) => r.documentId === document.id);
    if (docExplanations.length + docTerms.length + docCards.length === 0) continue;
    notes.push(
      buildObsidianNote({
        document,
        explanations: docExplanations,
        terms: docTerms,
        flashcards: docCards,
        exportedAt,
      })
    );
  }
  return notes;
}

/**
 * 浏览器端把笔记集合打包为 zip 下载（动态引入 jszip，避免影响首屏）
 */
export async function downloadObsidianZip(notes, filename = 'anchor-read-obsidian-notes.zip') {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const note of notes) {
    zip.file(note.filename, note.content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
