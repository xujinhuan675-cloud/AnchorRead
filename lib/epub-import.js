/**
 * EPUB 导入（纯客户端解析）
 * 流程：jszip 解包 → container.xml 定位 OPF → 按 spine 顺序读取章节 XHTML
 * → Readability/正文兜底 → htmlToMarkdown，全程不离开浏览器
 */

import JSZip from 'jszip';
import { Readability } from '@mozilla/readability';
import { htmlToMarkdown } from './html-to-markdown.js';

export class EpubImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EpubImportError';
  }
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'");
}

/** 从 container.xml 中找到 OPF 文件路径 */
function findOpfPath(containerXml) {
  const match = containerXml.match(/full-path\s*=\s*"([^"]+)"/iu);
  if (!match) throw new EpubImportError('EPUB 缺少 container.xml 中的 rootfile 声明。');
  return decodeXmlEntities(match[1]);
}

function dirOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index + 1);
}

function resolveHref(baseDir, href) {
  const cleanHref = decodeXmlEntities(href.split('#')[0]);
  const joined = `${baseDir}${cleanHref}`;
  // 简化处理 ../ 相对路径
  const segments = [];
  for (const segment of joined.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '.' && segment !== '') segments.push(segment);
  }
  return segments.join('/');
}

/** 解析 OPF：书名、manifest（id→href）、spine 阅读顺序 */
function parseOpf(opfText) {
  const xml = new DOMParser().parseFromString(opfText, 'application/xml');
  if (xml.querySelector('parsererror')) {
    throw new EpubImportError('EPUB 的 OPF 清单无法解析。');
  }

  const title =
    xml.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() ||
    xml.getElementsByTagName('dc:title')[0]?.textContent?.trim() ||
    '';

  const manifest = new Map();
  for (const item of xml.querySelectorAll('manifest > item, manifest item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  }

  const spine = [];
  for (const itemref of xml.querySelectorAll('spine > itemref, spine itemref')) {
    const idref = itemref.getAttribute('idref');
    const href = idref && manifest.get(idref);
    if (href && !spine.includes(href)) spine.push(href);
  }

  if (spine.length === 0) {
    throw new EpubImportError('EPUB 没有可读章节（spine 为空）。');
  }

  return { title, spine };
}

/** 单章 XHTML → Markdown，优先 Readability，兜底取 body */
function chapterToMarkdown(xhtmlText) {
  const document = new DOMParser().parseFromString(xhtmlText, 'text/html');
  document.querySelectorAll('script,style').forEach((node) => node.remove());

  try {
    const article = new Readability(document.cloneNode(true)).parse();
    if (article?.content) {
      const fragment = new DOMParser().parseFromString(article.content, 'text/html');
      const markdown = htmlToMarkdown(fragment);
      if (markdown) return markdown;
    }
  } catch {
    // Readability 对短章节可能抛错，走兜底
  }

  return htmlToMarkdown(document);
}

/**
 * 解析 EPUB 文件
 * @param {File|Blob} file
 * @returns {Promise<{title: string, content: string}>} Markdown 标题与正文
 */
export async function parseEpubFile(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new EpubImportError('无法解压该文件，请确认它是有效的 EPUB。');
  }

  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) {
    throw new EpubImportError('不是有效的 EPUB（缺少 META-INF/container.xml）。');
  }
  const opfPath = findOpfPath(await containerEntry.async('string'));

  const opfEntry = zip.file(opfPath);
  if (!opfEntry) {
    throw new EpubImportError('EPUB 清单文件缺失。');
  }
  const { title, spine } = parseOpf(await opfEntry.async('string'));
  const baseDir = dirOf(opfPath);

  const chapters = [];
  for (const href of spine) {
    const entry = zip.file(resolveHref(baseDir, href));
    if (!entry) continue;
    try {
      const markdown = chapterToMarkdown(await entry.async('string'));
      if (markdown) chapters.push(markdown);
    } catch {
      // 跳过无法解析的章节（如纯图片页）
    }
  }

  if (chapters.length === 0) {
    throw new EpubImportError('EPUB 中没有解析出任何正文内容。');
  }

  return { title, content: chapters.join('\n\n') };
}

/** 判断文件是否按 EPUB 处理 */
export function isEpubFile(file) {
  const name = String(file?.name || '').toLowerCase();
  return name.endsWith('.epub') || file?.type === 'application/epub+zip';
}
