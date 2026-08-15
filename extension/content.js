/**
 * AnchorRead 浏览器扩展 — content script（注入所有 http/https 页面）
 * 职责一：响应 background 的提取请求，序列化当前页「已渲染 DOM」，
 *        解决服务端重抓取失败的场景（纯 JS 渲染、强反爬、需要登录、内网页面）。
 * 职责二：本脚本同样注入在 AnchorRead 页面内，通过 window.postMessage
 *        把待交接载荷（剪藏 DOM 或原地阅读收件箱）交接给 AnchorRead 前端
 *        （网页无法直接读 chrome.storage）。
 */

const MAX_HTML_CHARS = 5 * 1024 * 1024;
const PENDING_CLIP_KEY = 'pendingClip';
const PENDING_INBOX_KEY = 'pendingInbox';
const CLIP_REQUEST_TYPE = 'anchorread/clip-request';
const CLIP_RESPONSE_TYPE = 'anchorread/clip-response';
/** 噪声节点：脚本、样式与嵌入式媒体对正文抽取没有价值 */
const NOISE_SELECTOR = 'script, style, noscript, template, iframe, canvas, svg';

/** 提取已渲染 DOM：克隆后清理噪声节点，并把相对 URL 解析为绝对地址 */
function extractRenderedHtml() {
  const root = document.documentElement.cloneNode(true);
  root.querySelectorAll(NOISE_SELECTOR).forEach((node) => node.remove());
  root.querySelectorAll('a[href]').forEach((el) => {
    if (el.href) el.setAttribute('href', el.href);
  });
  root.querySelectorAll('img[src]').forEach((el) => {
    if (el.src) el.setAttribute('src', el.src);
  });
  root.querySelectorAll('source[src]').forEach((el) => {
    if (el.src) el.setAttribute('src', el.src);
  });
  return root.outerHTML;
}

/** background 请求提取当前页渲染结果；同步返回，无需 keepalive */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'anchorread-extract-clip') return undefined;
  try {
    const html = extractRenderedHtml();
    if (html.length > MAX_HTML_CHARS) {
      sendResponse({ ok: false, reason: 'too-large' });
    } else {
      sendResponse({ ok: true, url: location.href, title: document.title, html });
    }
  } catch (error) {
    sendResponse({ ok: false, reason: String(error?.message || error) });
  }
  return undefined;
});

/**
 * AnchorRead 页面深链加载后，前端会轮询发起 clip-request（带 kind 区分载荷类型）；
 * kind=inbox 时回传原地阅读收件箱并通知 background 清空本地收件箱，
 * 其余情况回传剪藏的已渲染 DOM 载荷。
 */
window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data?.type !== CLIP_REQUEST_TYPE) return;
  const requestId = event.data.requestId;
  try {
    if (event.data.kind === 'inbox') {
      const { [PENDING_INBOX_KEY]: pendingInbox } = await chrome.storage.local.get(PENDING_INBOX_KEY);
      if (!pendingInbox || pendingInbox.kind !== 'inbox') return;
      window.postMessage({ type: CLIP_RESPONSE_TYPE, requestId, inbox: pendingInbox }, '*');
      await chrome.storage.local.remove(PENDING_INBOX_KEY);
      chrome.runtime.sendMessage({ type: 'anchorread-inbox-accepted' }).catch(() => {});
      return;
    }
    const { [PENDING_CLIP_KEY]: pendingClip } = await chrome.storage.local.get(PENDING_CLIP_KEY);
    if (!pendingClip?.html) return;
    window.postMessage({ type: CLIP_RESPONSE_TYPE, requestId, clip: pendingClip }, '*');
    await chrome.storage.local.remove(PENDING_CLIP_KEY);
  } catch (error) {
    console.warn('AnchorRead 扩展: 载荷交接失败', error);
  }
});
