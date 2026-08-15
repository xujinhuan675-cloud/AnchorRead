/**
 * AnchorRead 浏览器扩展 — MV3 service worker
 *
 * 剪藏：点击右键菜单「发送到 AnchorRead」，优先由 content script 提取当前页
 * 「已渲染 DOM」，暂存到 chrome.storage.local 后打开深链 `/?import=<url>&via=clipper`，
 * 由 AnchorRead 前端取回载荷并调用自身 /api/import-url 抽取正文入库；
 * 提取失败时回退为纯 URL 深链 `/?import=<url>`，由服务端重新抓取。
 *
 * 原地阅读：content script 划词后由这里代理调用 AnchorRead 的 /api/explain
 * （service worker fetch + host 权限绕过 CORS），采集结果暂存收件箱
 * （chrome.storage.local），侧边栏发起回流时经深链 `/?inbox=1&via=clipper`
 * 交回 AnchorRead 工作区。
 */

const DEFAULT_BASE_URL = 'http://localhost:3000';
const PENDING_CLIP_KEY = 'pendingClip';
const PENDING_INBOX_KEY = 'pendingInbox';
const INBOX_KEY = 'anchorReadInbox';
const GLOSSARY_KEY = 'anchorReadGlossary';
const MAX_INBOX_ITEMS = 200;

async function getSettings() {
  const { anchorReadBaseUrl, anchorReadAccessPassword, anchorReadApiKey } = await chrome.storage.sync.get([
    'anchorReadBaseUrl',
    'anchorReadAccessPassword',
    'anchorReadApiKey',
  ]);
  const baseUrl = String(anchorReadBaseUrl || '').trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
  return {
    baseUrl,
    accessPassword: String(anchorReadAccessPassword || '').trim(),
    apiKey: String(anchorReadApiKey || '').trim(),
  };
}

/** 请 content script 提取当前页渲染结果；无注入脚本或提取失败时返回 null */
async function extractClipFromTab(tab) {
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'anchorread-extract-clip' });
    return response?.ok && response.html ? response : null;
  } catch {
    return null;
  }
}

/** 打开 AnchorRead 深链；已有同源标签页则复用，避免重复开窗 */
async function openAnchorReadUrl(baseUrl, target) {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((item) => {
    try {
      return item.url && new URL(item.url).origin === new URL(baseUrl).origin;
    } catch {
      return false;
    }
  });

  if (existing) {
    await chrome.tabs.update(existing.id, { url: target, active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: target });
  }
}

async function sendTabToAnchorRead(tab, { linkUrl = '' } = {}) {
  const pageUrl = tab?.url || '';
  if (!/^https?:/i.test(pageUrl)) {
    return;
  }

  const { baseUrl } = await getSettings();
  const targetUrl = linkUrl || pageUrl;

  // 目标是当前页本身时，优先带上已渲染 DOM（右键链接指向别的页面，只能走 URL 重抓取）
  let via = '';
  if (!linkUrl) {
    const clip = await extractClipFromTab(tab);
    if (clip) {
      await chrome.storage.local.set({
        [PENDING_CLIP_KEY]: {
          url: clip.url,
          title: clip.title || '',
          html: clip.html,
          savedAt: Date.now(),
        },
      });
      via = '&via=clipper';
    }
  }
  await openAnchorReadUrl(baseUrl, `${baseUrl}/?import=${encodeURIComponent(targetUrl)}${via}`);
}

/**
 * 代理原地解读请求：扩展不持有 LLM 配置，必须走服务端访问密码路径
 * （ACCESS_PASSWORD + SERVER_LLM_*）；服务端设置了 ANCHORREAD_API_KEY 时附带 x-api-key
 */
async function handleExplain(message) {
  const selectedText = String(message?.selectedText || '').trim();
  const pageContext = String(message?.pageContext || '').trim();
  if (!selectedText || !pageContext) {
    return { ok: false, error: '选中文本或页面上下文为空' };
  }

  const settings = await getSettings();
  if (!settings.accessPassword) {
    return {
      ok: false,
      error: '尚未配置访问密码。请在扩展选项页填写（服务端需启用 ACCESS_PASSWORD 并配置 SERVER_LLM_*）。',
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-access-password': settings.accessPassword,
  };
  if (settings.apiKey) headers['x-api-key'] = settings.apiKey;

  let response;
  try {
    response = await fetch(`${settings.baseUrl}/api/explain`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        article: pageContext,
        selectedText,
        glossary: Array.isArray(message?.glossary) ? message.glossary : [],
        config: null,
      }),
    });
  } catch (fetchError) {
    return { ok: false, error: `无法连接 AnchorRead 实例：${fetchError?.message || fetchError}` };
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: body.error || `解读请求失败 (${response.status})` };
  }
  return { ok: true, result: body };
}

/** 收件箱追加：原地解读卡「存收件箱」写入，侧边栏展示与回流 */
async function saveInboxItem(item) {
  if (!item || typeof item !== 'object' || !String(item.selectedText || '').trim()) {
    return { ok: false, error: '收件箱条目无效' };
  }
  const { [INBOX_KEY]: inbox } = await chrome.storage.local.get(INBOX_KEY);
  const list = Array.isArray(inbox) ? inbox : [];
  list.push({
    id: item.id || `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: String(item.url || ''),
    title: String(item.title || ''),
    selectedText: String(item.selectedText || ''),
    plainExplanation: String(item.plainExplanation || ''),
    context: String(item.context || ''),
    terms: Array.isArray(item.terms) ? item.terms : [],
    savedAt: Number.isFinite(item.savedAt) ? item.savedAt : Date.now(),
  });
  await chrome.storage.local.set({ [INBOX_KEY]: list.slice(-MAX_INBOX_ITEMS) });
  return { ok: true };
}

async function removeInboxItem(id) {
  const { [INBOX_KEY]: inbox } = await chrome.storage.local.get(INBOX_KEY);
  const list = Array.isArray(inbox) ? inbox.filter((entry) => entry.id !== id) : [];
  await chrome.storage.local.set({ [INBOX_KEY]: list });
  return { ok: true };
}

/**
 * 回流收件箱：把收件箱与扩展本地术语表暂存为 pendingInbox，
 * 打开深链交回 AnchorRead；交接成功后由 content script 回报并清空收件箱
 */
async function sendInboxToAnchorRead() {
  const { [INBOX_KEY]: inbox, [GLOSSARY_KEY]: glossary } = await chrome.storage.local.get([INBOX_KEY, GLOSSARY_KEY]);
  const inboxItems = Array.isArray(inbox) ? inbox : [];
  const glossaryTerms = Array.isArray(glossary) ? glossary : [];
  if (inboxItems.length === 0 && glossaryTerms.length === 0) {
    return { ok: false, error: '收件箱为空，没有可回流的内容' };
  }

  const settings = await getSettings();
  await chrome.storage.local.set({
    [PENDING_INBOX_KEY]: {
      kind: 'inbox',
      inboxItems,
      glossaryTerms,
      savedAt: Date.now(),
    },
  });
  await openAnchorReadUrl(settings.baseUrl, `${settings.baseUrl}/?inbox=1&via=clipper`);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (!type || !type.startsWith('anchorread-')) return undefined;

  const respond = (payload) => sendResponse(payload);
  switch (type) {
    case 'anchorread-explain':
      handleExplain(message).then(respond).catch((error) => respond({ ok: false, error: String(error?.message || error) }));
      return true;
    case 'anchorread-save-inbox':
      saveInboxItem(message.item).then(respond).catch((error) => respond({ ok: false, error: String(error?.message || error) }));
      return true;
    case 'anchorread-remove-inbox':
      removeInboxItem(message.id).then(respond).catch((error) => respond({ ok: false, error: String(error?.message || error) }));
      return true;
    case 'anchorread-send-inbox':
      sendInboxToAnchorRead().then(respond).catch((error) => respond({ ok: false, error: String(error?.message || error) }));
      return true;
    case 'anchorread-inbox-accepted':
      // AnchorRead 页面已完成收件箱交接，清空本地收件箱（保留术语表，可继续累积）
      chrome.storage.local.set({ [INBOX_KEY]: [] }).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
      return true;
    case 'anchorread-deep-read':
      // 原地解读卡「深读本页」：走既有剪藏链路
      if (sender.tab) {
        sendTabToAnchorRead(sender.tab).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
        return true;
      }
      respond({ ok: false });
      return undefined;
    case 'anchorread-open-panel':
      // 侧边栏只能在用户手势内打开；content script 的点击经消息转发后可能被拒，失败时静默
      if (sender.tab?.id) {
        chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
        return true;
      }
      respond({ ok: false });
      return undefined;
    default:
      return undefined;
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch((error) => {
    console.error('AnchorRead: 打开侧边栏失败', error);
  });
});

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'send-to-anchorread') {
    // 右键链接：目标是链接地址而非当前页，只能走 URL 重抓取
    sendTabToAnchorRead(tab, { linkUrl: info.linkUrl || '' }).catch((error) => {
      console.error('AnchorRead Clipper:', error);
    });
  } else if (info.menuItemId === 'explain-selection' && tab?.id) {
    // 右键划词解读：通知 content script 用当前选区直接打开解读卡
    chrome.tabs.sendMessage(tab.id, { type: 'anchorread-explain-selection' }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create({
    id: 'send-to-anchorread',
    title: '发送到 AnchorRead',
    contexts: ['page', 'link'],
  });
  chrome.contextMenus?.create({
    id: 'explain-selection',
    title: 'AnchorRead 解读选中文本',
    contexts: ['selection'],
  });
});
