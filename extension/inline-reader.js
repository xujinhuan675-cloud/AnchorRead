/**
 * AnchorRead 浏览器扩展 — 原地阅读层（content script）
 * 任意网页划词后在选区旁出现「解读」悬浮按钮，点击经 background 代理调用
 * AnchorRead 的 /api/explain，展示贴近原文的解读卡；支持存收件箱、复制、
 * 打开侧边栏、深读本页（走既有剪藏链路）。
 * 全部 UI 位于 Shadow DOM 内，不与宿主页面样式互相污染。
 * 一期不做全文自动术语高亮：SPA 重渲染会导致锚点失效，留待二期。
 */

const MAX_SELECTION_CHARS = 2000;
const MAX_CONTEXT_CHARS = 2000;
const GLOSSARY_KEY = 'anchorReadGlossary';
const HOST_TAG = 'anchorread-inline-host';

(function initInlineReader() {
  // 仅在主文档注入：iframe 内的划词场景复杂且收益低，一期跳过
  if (window.top !== window.self) return;
  if (document.querySelector(HOST_TAG)) return;

  // AnchorRead 自己的页面有内置阅读工作台，不再叠加原地层
  chrome.storage.sync.get('anchorReadBaseUrl', ({ anchorReadBaseUrl }) => {
    try {
      const baseOrigin = new URL(anchorReadBaseUrl || 'http://localhost:3000').origin;
      if (window.location.origin === baseOrigin) return;
    } catch {
      // 配置非法时按默认地址判断，不阻断初始化
      if (['http://localhost:3000', 'http://127.0.0.1:3000'].includes(window.location.origin)) return;
    }
    bootstrap();
  });
})();

function bootstrap() {
  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'position: absolute; top: 0; left: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
    .ar-trigger, .ar-card { pointer-events: auto; position: absolute; }
    .ar-trigger button {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 12px; border: none; border-radius: 999px;
      background: #0f766e; color: #fff; font-size: 13px; font-weight: 600;
      box-shadow: 0 4px 14px rgba(15, 118, 110, 0.35); cursor: pointer;
    }
    .ar-trigger button:hover { background: #115e59; }
    .ar-card {
      width: 360px; max-width: calc(100vw - 24px);
      background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
      box-shadow: 0 12px 32px rgba(17, 24, 39, 0.18);
      display: flex; flex-direction: column; max-height: 420px;
    }
    .ar-card-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid #f3f4f6;
    }
    .ar-card-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: #0f766e; }
    .ar-card-title::before { content: ''; width: 8px; height: 8px; border-radius: 2px; background: #0f766e; }
    .ar-close { border: none; background: none; color: #9ca3af; font-size: 16px; cursor: pointer; line-height: 1; padding: 2px; }
    .ar-close:hover { color: #374151; }
    .ar-card-body { padding: 12px 14px; overflow-y: auto; font-size: 13px; line-height: 1.7; color: #1f2937; }
    .ar-quote { color: #6b7280; font-size: 12px; border-left: 3px solid #ccfbf1; padding-left: 8px; margin: 0 0 8px; }
    .ar-plain { margin: 0 0 10px; }
    .ar-context { margin: 0; color: #6b7280; font-size: 12px; }
    .ar-label { font-size: 12px; font-weight: 600; color: #374151; margin: 4px 0 6px; }
    .ar-terms { margin: 0; padding: 0; list-style: none; }
    .ar-terms li { padding: 6px 8px; border-radius: 6px; background: #f0fdfa; margin-bottom: 6px; }
    .ar-term-name { font-weight: 600; color: #0f766e; }
    .ar-status { color: #6b7280; }
    .ar-error { color: #b91c1c; }
    .ar-card-footer {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 10px 14px; border-top: 1px solid #f3f4f6;
    }
    .ar-card-footer button {
      padding: 5px 10px; font-size: 12px; border-radius: 6px; cursor: pointer;
      border: 1px solid #d1d5db; background: #fff; color: #374151;
    }
    .ar-card-footer button:hover:not(:disabled) { border-color: #0f766e; color: #0f766e; }
    .ar-card-footer button:disabled { opacity: 0.6; cursor: default; }
    .ar-card-footer button.ar-primary { background: #0f766e; border-color: #0f766e; color: #fff; }
    .ar-card-footer button.ar-primary:hover:not(:disabled) { background: #115e59; color: #fff; }
    .ar-hidden { display: none !important; }
  `;

  const trigger = document.createElement('div');
  trigger.className = 'ar-trigger ar-hidden';
  const triggerButton = document.createElement('button');
  triggerButton.type = 'button';
  triggerButton.setAttribute('aria-label', 'AnchorRead 解读选中文本');
  triggerButton.textContent = '⚓ 解读';
  trigger.appendChild(triggerButton);

  const card = document.createElement('div');
  card.className = 'ar-card ar-hidden';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'AnchorRead 原地解读');

  shadow.append(style, trigger, card);
  document.documentElement.appendChild(host);

  /** 当前解读卡承载的选区快照：解读期间页面选区可能变化，提前固化 */
  let activeSnapshot = null;
  let saved = false;

  function docLeft(clientX) {
    return clientX + window.scrollX;
  }
  function docTop(clientY) {
    return clientY + window.scrollY;
  }

  function hideTrigger() {
    trigger.classList.add('ar-hidden');
  }
  function hideCard() {
    card.classList.add('ar-hidden');
    activeSnapshot = null;
    saved = false;
  }
  function hideAll() {
    hideTrigger();
    hideCard();
  }

  /** 规整后的选中文本：与服务端 explain 契约的压缩规则保持一致 */
  function compact(text) {
    return String(text || '').replace(/\s+/gu, ' ').trim();
  }

  /**
   * 页面上下文：以选中文本在正文中的位置为中心截取窗口，
   * 让 AI 看到前后文而不是孤立句子；找不到定位时退化为正文开头
   */
  function buildPageContext(selectedText) {
    const bodyText = compact(document.body?.innerText || '');
    const index = selectedText ? bodyText.indexOf(selectedText) : -1;
    if (index === -1) return bodyText.slice(0, MAX_CONTEXT_CHARS);
    const half = Math.max(Math.floor((MAX_CONTEXT_CHARS - selectedText.length) / 2), 0);
    const start = Math.max(index - half, 0);
    return bodyText.slice(start, start + MAX_CONTEXT_CHARS);
  }

  async function loadGlossary() {
    try {
      const { [GLOSSARY_KEY]: glossary } = await chrome.storage.local.get(GLOSSARY_KEY);
      return (Array.isArray(glossary) ? glossary : [])
        .map((entry) => ({
          term: compact(entry?.term),
          aliases: Array.isArray(entry?.aliases) ? entry.aliases : [],
          explanation: compact(entry?.explanation),
        }))
        .filter((entry) => entry.term);
    } catch {
      return [];
    }
  }

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = compact(selection.toString());
    if (text.length < 2 || text.length > MAX_SELECTION_CHARS) return null;
    // 选中我们自己的 UI 时不触发：shadow 内节点不在 host 的 contains 范围内，需看根节点
    const anchor = selection.anchorNode;
    if (anchor && (anchor === host || anchor.getRootNode?.() === shadow)) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { text, rect };
  }

  function showTrigger(rect) {
    hideCard();
    const left = Math.max(docLeft(rect.right) - 72, 8);
    const top = docTop(rect.bottom) + 8;
    trigger.style.left = `${left}px`;
    trigger.style.top = `${top}px`;
    trigger.classList.remove('ar-hidden');
  }

  function renderCardShell(rect) {
    const viewportWidth = document.documentElement.clientWidth;
    const cardWidth = Math.min(360, viewportWidth - 24);
    let left = docLeft(rect.left);
    const maxLeft = window.scrollX + viewportWidth - cardWidth - 8;
    left = Math.min(Math.max(left, window.scrollX + 8), Math.max(maxLeft, window.scrollX + 8));
    card.style.width = `${cardWidth}px`;
    card.style.left = `${left}px`;
    card.style.top = `${docTop(rect.bottom) + 10}px`;
    card.classList.remove('ar-hidden');
  }

  /** 安全建节点：解读内容来自 LLM 响应，一律走 textContent，不经过 markup 解析 */
  function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function cardHeader() {
    const header = el('div', 'ar-card-header');
    header.appendChild(el('span', 'ar-card-title', 'AnchorRead 解读'));
    const close = el('button', 'ar-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', hideAll);
    header.appendChild(close);
    return header;
  }

  function renderLoading() {
    const body = el('div', 'ar-card-body');
    body.appendChild(el('p', 'ar-status', '正在结合上下文解读…'));
    card.replaceChildren(cardHeader(), body);
  }

  function renderError(message) {
    const body = el('div', 'ar-card-body');
    body.appendChild(el('p', 'ar-error', message || '解读失败，请重试。'));
    card.replaceChildren(cardHeader(), body);
  }

  function renderResult(snapshot, result) {
    const body = el('div', 'ar-card-body');
    body.appendChild(el('p', 'ar-quote', `「${snapshot.text}」`));
    body.appendChild(el('p', 'ar-plain', result.plainExplanation || ''));
    const terms = Array.isArray(result?.terms) ? result.terms : [];
    if (terms.length > 0) {
      body.appendChild(el('p', 'ar-label', '术语'));
      const list = el('ul', 'ar-terms');
      for (const term of terms) {
        const item = el('li');
        item.appendChild(el('span', 'ar-term-name', term.source));
        item.append('：', term.explanation);
        list.appendChild(item);
      }
      body.appendChild(list);
    }
    if (result?.context) {
      body.appendChild(el('p', 'ar-label', '上下文'));
      body.appendChild(el('p', 'ar-context', result.context));
    }

    const footer = el('div', 'ar-card-footer');
    const actions = [
      { action: 'save', label: '存收件箱', primary: true },
      { action: 'copy', label: '复制' },
      { action: 'panel', label: '侧边栏' },
      { action: 'deep-read', label: '深读本页' },
    ];
    for (const { action, label, primary } of actions) {
      const button = el('button', primary ? 'ar-primary' : '', label);
      button.type = 'button';
      button.dataset.action = action;
      footer.appendChild(button);
    }
    card.replaceChildren(cardHeader(), body, footer);
    bindActions(snapshot, result);
  }

  function buildInboxItem(snapshot, result) {
    return {
      url: window.location.href,
      title: document.title,
      selectedText: snapshot.text,
      plainExplanation: result.plainExplanation || '',
      context: result.context || '',
      terms: Array.isArray(result.terms) ? result.terms : [],
      savedAt: Date.now(),
    };
  }

  function bindActions(snapshot, result) {
    card.querySelector('[data-action="save"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (saved) return;
      button.disabled = true;
      const response = await chrome.runtime.sendMessage({
        type: 'anchorread-save-inbox',
        item: buildInboxItem(snapshot, result),
      }).catch(() => null);
      saved = Boolean(response?.ok);
      button.textContent = saved ? '已存入' : '保存失败';
    });
    card.querySelector('[data-action="copy"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      try {
        await navigator.clipboard.writeText(`「${snapshot.text}」\n\n${result.plainExplanation || ''}`);
        button.textContent = '已复制';
      } catch {
        button.textContent = '复制失败';
      }
    });
    card.querySelector('[data-action="panel"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const response = await chrome.runtime.sendMessage({ type: 'anchorread-open-panel' }).catch(() => null);
      button.textContent = response?.ok ? '已打开' : '请点工具栏图标';
    });
    card.querySelector('[data-action="deep-read"]')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'anchorread-deep-read' }).catch(() => {});
      hideAll();
    });
  }

  async function startExplain(snapshot) {
    hideTrigger();
    activeSnapshot = snapshot;
    saved = false;
    renderCardShell(snapshot.rect);
    renderLoading();

    const glossary = await loadGlossary();
    const response = await chrome.runtime.sendMessage({
      type: 'anchorread-explain',
      selectedText: snapshot.text,
      pageContext: buildPageContext(snapshot.text),
      glossary,
      url: window.location.href,
    }).catch((error) => ({ ok: false, error: String(error?.message || error) }));

    // 解读期间用户可能又发起了新的选区，旧结果直接丢弃
    if (activeSnapshot !== snapshot) return;
    if (!response?.ok) {
      renderError(response?.error);
      return;
    }
    renderResult(snapshot, response.result);
  }
  // 划词结束（鼠标或 Shift+方向键）后在选区旁显示触发按钮
  const handleSelectionChange = () => {
    const snapshot = captureSelection();
    if (!snapshot) {
      hideTrigger();
      return;
    }
    showTrigger(snapshot.rect);
  };
  document.addEventListener('mouseup', () => window.setTimeout(handleSelectionChange, 0), true);
  document.addEventListener('keyup', (event) => {
    if (!event.shiftKey) return;
    window.setTimeout(handleSelectionChange, 0);
  }, true);

  triggerButton.addEventListener('click', () => {
    const snapshot = captureSelection();
    if (snapshot) startExplain(snapshot);
  });

  // 点击宿主页面其它位置时收起全部 UI；Escape 同样收起
  document.addEventListener('mousedown', (event) => {
    if (event.composedPath().includes(host)) return;
    hideAll();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideAll();
  }, true);
  // 滚动后触发按钮的坐标失效，直接收起；解读卡按文档坐标定位，随页面滚动不受影响
  window.addEventListener('scroll', hideTrigger, { passive: true });

  // 右键菜单「AnchorRead 解读选中文本」：直接用当前选区打开解读卡
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'anchorread-explain-selection') return undefined;
    const snapshot = captureSelection();
    if (snapshot) startExplain(snapshot);
    return undefined;
  });
}
