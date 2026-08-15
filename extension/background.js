/**
 * AnchorRead Clipper — MV3 service worker
 * 点击工具栏图标：把当前页 URL 通过深链 `/?import=<url>` 发给 AnchorRead，
 * 由 AnchorRead 前端调用自身 /api/import-url 抽取正文并入库。
 */

const DEFAULT_BASE_URL = 'http://localhost:3000';

async function getBaseUrl() {
  const { anchorReadBaseUrl } = await chrome.storage.sync.get('anchorReadBaseUrl');
  const url = String(anchorReadBaseUrl || '').trim().replace(/\/+$/, '');
  return url || DEFAULT_BASE_URL;
}

async function sendTabToAnchorRead(tab) {
  const pageUrl = tab?.url || '';
  if (!/^https?:/i.test(pageUrl)) {
    return;
  }

  const baseUrl = await getBaseUrl();
  const target = `${baseUrl}/?import=${encodeURIComponent(pageUrl)}`;

  // 若已有打开的 AnchorRead 标签页则复用，避免重复开窗
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

chrome.action.onClicked.addListener((tab) => {
  sendTabToAnchorRead(tab).catch((error) => {
    console.error('AnchorRead Clipper:', error);
  });
});

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'send-to-anchorread') return;
  const target = info.linkUrl || info.pageUrl || tab?.url;
  sendTabToAnchorRead({ url: target }).catch((error) => {
    console.error('AnchorRead Clipper:', error);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create({
    id: 'send-to-anchorread',
    title: '发送到 AnchorRead',
    contexts: ['page', 'link'],
  });
});
