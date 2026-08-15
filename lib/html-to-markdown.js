/**
 * HTML → Markdown 转换器（通用 DOM 遍历实现）
 * 同时兼容服务端 linkedom 与浏览器原生 DOM，
 * 供 URL 导入（服务端 Readability 抽取后）与 EPUB 导入（客户端章节解析）复用
 */

const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'form', 'button', 'select', 'input',
]);

const INLINE_TAGS = new Set([
  'a', 'strong', 'b', 'em', 'i', 'code', 'span', 'br', 'img', 'sub', 'sup', 'small', 'mark', 'u',
]);

function tagName(node) {
  return String(node?.tagName || node?.nodeName || '').toLowerCase();
}

function textContent(node) {
  return String(node?.textContent || '').replace(/\s+/gu, ' ').trim();
}

/** 行内渲染：返回一段不带块级换行的 Markdown */
function renderInline(node) {
  if (!node) return '';
  if (node.nodeType === 3) {
    return String(node.nodeValue || '').replace(/\s+/gu, ' ');
  }
  const tag = tagName(node);
  if (SKIP_TAGS.has(tag)) return '';

  const children = () =>
    [...(node.childNodes || [])].map(renderInline).join('');

  switch (tag) {
    case 'br':
      return '\n';
    case 'strong':
    case 'b': {
      const inner = children().trim();
      return inner ? `**${inner}**` : '';
    }
    case 'em':
    case 'i': {
      const inner = children().trim();
      return inner ? `*${inner}*` : '';
    }
    case 'code': {
      const inner = textContent(node);
      return inner ? `\`${inner}\`` : '';
    }
    case 'a': {
      const inner = children().trim();
      const href = node.getAttribute?.('href') || '';
      if (!inner) return '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return inner;
      return `[${inner}](${href})`;
    }
    case 'img': {
      const alt = node.getAttribute?.('alt') || '';
      const src = node.getAttribute?.('src') || '';
      return src ? `![${alt}](${src})` : '';
    }
    default:
      return children();
  }
}

function inlineBlock(node) {
  return renderInline(node).replace(/[ \t]+/gu, ' ').trim();
}

function renderTable(node) {
  const rows = [...(node.querySelectorAll?.('tr') || [])];
  if (rows.length === 0) return '';
  const lines = rows.map((row) => {
    const cells = [...(row.childNodes || [])].filter(
      (cell) => ['td', 'th'].includes(tagName(cell))
    );
    return `| ${cells.map((cell) => inlineBlock(cell).replace(/\|/gu, '\\|')).join(' | ')} |`;
  });
  const columnCount = Math.max(
    1,
    ...rows.map((row) => [...(row.childNodes || [])].filter((c) => ['td', 'th'].includes(tagName(c))).length)
  );
  const separator = `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`;
  lines.splice(1, 0, separator);
  return lines.join('\n');
}

function renderList(node, ordered) {
  const items = [...(node.childNodes || [])].filter((child) => tagName(child) === 'li');
  return items
    .map((item, index) => {
      const blocks = renderChildren(item).split('\n\n').filter(Boolean);
      const marker = ordered ? `${index + 1}.` : '-';
      const [first, ...rest] = blocks;
      const head = `${marker} ${first || ''}`;
      const tail = rest.map((block) => `  ${block.split('\n').join('\n  ')}`).join('\n');
      return tail ? `${head}\n${tail}` : head;
    })
    .join('\n');
}

/** 块级渲染：返回以空行分隔的 Markdown 块 */
function renderChildren(node) {
  const blocks = [];
  for (const child of node.childNodes || []) {
    const block = renderBlock(child);
    if (block) blocks.push(block);
  }
  return blocks.join('\n\n');
}

function renderBlock(node) {
  if (!node) return '';
  if (node.nodeType === 3) {
    const text = String(node.nodeValue || '').trim();
    return text.replace(/\s+/gu, ' ');
  }
  const tag = tagName(node);
  if (SKIP_TAGS.has(tag)) return '';

  const heading = tag.match(/^h([1-6])$/u);
  if (heading) {
    const text = inlineBlock(node);
    return text ? `${'#'.repeat(Number(heading[1]))} ${text}` : '';
  }

  switch (tag) {
    case 'p':
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'span':
    case 'figure': {
      // 含块级子节点时递归，否则按段落行内处理（忽略 script/style 等非内容标签）
      const hasBlockChild = [...(node.childNodes || [])].some((child) => {
        const childTag = tagName(child);
        return child.nodeType === 1 && !SKIP_TAGS.has(childTag) && !INLINE_TAGS.has(childTag);
      });
      if (hasBlockChild) return renderChildren(node);
      const text = inlineBlock(node);
      return text || '';
    }
    case 'ul':
      return renderList(node, false);
    case 'ol':
      return renderList(node, true);
    case 'blockquote': {
      const inner = renderChildren(node);
      return inner
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    }
    case 'pre': {
      const code = textContent(node);
      return code ? `\`\`\`\n${code}\n\`\`\`` : '';
    }
    case 'table':
      return renderTable(node);
    case 'hr':
      return '---';
    case 'figcaption':
    case 'caption':
      return '';
    default:
      if (node.childNodes?.length) return renderChildren(node);
      return inlineBlock(node);
  }
}

/**
 * 将 DOM 根节点转换为 Markdown 文本
 * @param {Node} root - document 或任意元素节点
 * @returns {string}
 */
export function htmlToMarkdown(root) {
  if (!root) return '';
  const body = root.body || root;
  const markdown = renderChildren(body);
  return markdown
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]+$/gmu, '')
    .trim();
}
