import { NextResponse } from 'next/server';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { htmlToMarkdown } from '@/lib/html-to-markdown';
import { authorizeApiRequest } from '@/lib/api-auth';

/**
 * POST /api/import-url
 * 从网页抽取正文：Readability 提取 + HTML→Markdown 转换
 * 入参：{ url }，或 { url, html, title? }（浏览器扩展直接提供已渲染 DOM，服务端不再抓取）
 * 出参：{ title, content, sourceUrl, excerpt }
 */

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
/** 扩展提供的已渲染 HTML 上限（与 content script 侧的截断保持一致） */
const MAX_PROVIDED_HTML_BYTES = 5 * 1024 * 1024;

/** SSRF 防护：拒绝内网/回环地址 */
function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host.startsWith('127.') || host === '::1' || host === '[::1]') return true;
  if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./u.test(host)) return true;
  return false;
}

export async function POST(request) {
  const denied = authorizeApiRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    const providedHtml = typeof body.html === 'string' ? body.html : '';
    const providedTitle = typeof body.title === 'string' ? body.title.trim() : '';

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return NextResponse.json({ error: '请输入有效的网址（以 http:// 或 https:// 开头）' }, { status: 400 });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: '仅支持 http/https 网址' }, { status: 400 });
    }
    let html;
    if (providedHtml) {
      // 浏览器扩展提供的是当前页已渲染 DOM：服务端不发起抓取，
      // 因此不受 SSRF 限制（内网页面也可剪藏），也不需要绕过反爬
      if (Buffer.byteLength(providedHtml, 'utf8') > MAX_PROVIDED_HTML_BYTES) {
        return NextResponse.json({ error: '提交的页面 HTML 过大，超过 5MB 限制' }, { status: 400 });
      }
      html = providedHtml;
    } else {
      if (isBlockedHost(parsed.hostname)) {
        return NextResponse.json({ error: '不允许抓取内网地址' }, { status: 400 });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(parsed.href, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AnchorRead/0.1; +https://github.com)',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });
      } catch (fetchError) {
        const reason = fetchError?.name === 'AbortError' ? '抓取超时，请稍后重试' : `无法访问该网址：${fetchError?.message || fetchError}`;
        return NextResponse.json({ error: reason }, { status: 502 });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        return NextResponse.json({ error: `网页返回 ${response.status}，无法抓取正文` }, { status: 502 });
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_RESPONSE_BYTES) {
        return NextResponse.json({ error: '网页过大，超过 10MB 限制' }, { status: 502 });
      }

      html = await response.text();
    }

    const { document } = parseHTML(html);
    const article = new Readability(document).parse();

    if (!article || !article.content || !article.textContent?.trim()) {
      return NextResponse.json(
        { error: '未能从该网页识别出正文，可尝试复制正文后粘贴导入' },
        { status: 502 }
      );
    }

    // Readability 输出以 <DIV> 开头，linkedom 会把首个标签误当作根节点导致 body 为空，
    // 包一层完整 <html><body> 再解析，保证 htmlToMarkdown 能遍历到正文
    const { document: fragment } = parseHTML(`<html><body>${article.content}</body></html>`);
    const markdown = htmlToMarkdown(fragment);
    if (!markdown.trim()) {
      return NextResponse.json({ error: '正文抽取结果为空，请尝试其他网页' }, { status: 502 });
    }

    return NextResponse.json({
      title: article.title || providedTitle || parsed.hostname,
      content: markdown,
      sourceUrl: parsed.href,
      excerpt: typeof article.excerpt === 'string' ? article.excerpt : '',
    });
  } catch (error) {
    console.error('Error importing url:', error);
    return NextResponse.json({ error: error.message || '网址导入失败' }, { status: 500 });
  }
}
