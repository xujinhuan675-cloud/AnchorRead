/**
 * AnchorRead 浏览器扩展 — 侧边栏（chrome.sidePanel）
 * 两个视图：收件箱（原地解读的暂存区，支持按当前页过滤与删除）与
 * 扩展本地术语表（解读时作为背景交代给 AI）。顶部「回流到 AnchorRead」
 * 把两者经深链握手交回 AnchorRead 工作区，交接成功后收件箱自动清空。
 * 全部动态内容走 textContent，不经过 markup 解析。
 */

const INBOX_KEY = 'anchorReadInbox';
const GLOSSARY_KEY = 'anchorReadGlossary';

const state = {
  tab: 'inbox',
  filter: 'all',
  inbox: [],
  glossary: [],
  currentTabUrl: '',
};

const elements = {
  statusLine: document.getElementById('status-line'),
  sendInbox: document.getElementById('send-inbox'),
  tabInbox: document.getElementById('tab-inbox'),
  tabGlossary: document.getElementById('tab-glossary'),
  viewInbox: document.getElementById('view-inbox'),
  viewGlossary: document.getElementById('view-glossary'),
  filterAll: document.getElementById('filter-all'),
  filterPage: document.getElementById('filter-page'),
  inboxCount: document.getElementById('inbox-count'),
  inboxList: document.getElementById('inbox-list'),
  glossaryForm: document.getElementById('glossary-form'),
  glossaryTerm: document.getElementById('glossary-term'),
  glossaryExplanation: document.getElementById('glossary-explanation'),
  glossaryList: document.getElementById('glossary-list'),
};

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function setStatus(message, isError = false) {
  if (!message) {
    elements.statusLine.classList.add('ar-hidden');
    return;
  }
  elements.statusLine.textContent = message;
  elements.statusLine.classList.remove('ar-hidden');
  elements.statusLine.classList.toggle('is-error', isError);
}

function formatTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

async function loadState() {
  const { [INBOX_KEY]: inbox, [GLOSSARY_KEY]: glossary } = await chrome.storage.local.get([INBOX_KEY, GLOSSARY_KEY]);
  state.inbox = Array.isArray(inbox) ? inbox : [];
  state.glossary = Array.isArray(glossary) ? glossary : [];
}

async function loadCurrentTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    state.currentTabUrl = tab?.url || '';
  } catch {
    state.currentTabUrl = '';
  }
}

function switchTab(tab) {
  state.tab = tab;
  elements.tabInbox.setAttribute('aria-selected', String(tab === 'inbox'));
  elements.tabGlossary.setAttribute('aria-selected', String(tab === 'glossary'));
  elements.viewInbox.classList.toggle('ar-hidden', tab !== 'inbox');
  elements.viewGlossary.classList.toggle('ar-hidden', tab !== 'glossary');
}

/** 收件箱条目卡：默认折叠只显示选区引文，点开看完整解读与术语 */
function buildInboxItem(item) {
  const container = el('article', 'ar-item');

  const head = el('div', 'ar-item-head');
  head.appendChild(el('span', 'ar-item-title', item.title || item.url || '未知页面'));
  head.appendChild(el('span', 'ar-item-time', formatTime(item.savedAt)));
  container.appendChild(head);
  container.appendChild(el('p', 'ar-item-quote', `「${item.selectedText || ''}」`));
  container.appendChild(el('p', 'ar-item-explain', item.plainExplanation || ''));

  const terms = Array.isArray(item.terms) ? item.terms : [];
  if (terms.length > 0) {
    const list = el('ul', 'ar-item-terms');
    for (const term of terms) {
      const entry = el('li');
      entry.appendChild(el('span', 'ar-term-name', term.source || ''));
      entry.append(`：${term.explanation || ''}`);
      list.appendChild(entry);
    }
    container.appendChild(list);
  }

  const actions = el('div', 'ar-item-actions');
  const toggle = el('button', '', '展开');
  toggle.type = 'button';
  toggle.addEventListener('click', () => {
    const open = container.classList.toggle('is-open');
    toggle.textContent = open ? '收起' : '展开';
  });
  const remove = el('button', 'ar-danger', '删除');
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'anchorread-remove-inbox', id: item.id }).catch(() => {});
    await loadState();
    render();
  });
  actions.append(toggle, remove);
  container.appendChild(actions);
  return container;
}

function renderInbox() {
  const items = state.filter === 'page' && state.currentTabUrl
    ? state.inbox.filter((item) => item.url === state.currentTabUrl)
    : state.inbox;

  elements.filterAll.setAttribute('aria-pressed', String(state.filter === 'all'));
  elements.filterPage.setAttribute('aria-pressed', String(state.filter === 'page'));
  elements.filterPage.disabled = !state.currentTabUrl || !/^https?:/i.test(state.currentTabUrl);
  elements.inboxCount.textContent = `${items.length} / ${state.inbox.length} 条`;
  elements.sendInbox.disabled = state.inbox.length === 0;

  elements.inboxList.replaceChildren();
  if (items.length === 0) {
    elements.inboxList.appendChild(el(
      'p',
      'ar-empty',
      state.inbox.length === 0
        ? '收件箱为空。在任意网页划词后点「⚓ 解读」，把解读存进这里，再一键回流到 AnchorRead 工作区。'
        : '当前页面没有采集记录，切到「全部」查看其它页面。'
    ));
    return;
  }
  for (const item of [...items].sort((left, right) => (right.savedAt || 0) - (left.savedAt || 0))) {
    elements.inboxList.appendChild(buildInboxItem(item));
  }
}

function renderGlossary() {
  elements.glossaryList.replaceChildren();
  if (state.glossary.length === 0) {
    elements.glossaryList.appendChild(el(
      'p',
      'ar-empty',
      '术语表为空。这里维护的术语会作为背景交代给 AI：原地解读命中时不再重复解释；回流时一并并入 AnchorRead 术语表。'
    ));
    return;
  }
  for (const entry of state.glossary) {
    const container = el('article', 'ar-item ar-glossary-item');
    const body = el('div', 'ar-glossary-body');
    body.appendChild(el('p', 'ar-glossary-term', entry.term || ''));
    if (entry.explanation) body.appendChild(el('p', 'ar-glossary-explain', entry.explanation));
    const remove = el('button', 'ar-danger', '删除');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      const next = state.glossary.filter((item) => item.id !== entry.id);
      await chrome.storage.local.set({ [GLOSSARY_KEY]: next });
      state.glossary = next;
      renderGlossary();
    });
    container.append(body, remove);
    elements.glossaryList.appendChild(container);
  }
}

function render() {
  renderInbox();
  renderGlossary();
}

elements.tabInbox.addEventListener('click', () => switchTab('inbox'));
elements.tabGlossary.addEventListener('click', () => switchTab('glossary'));
elements.filterAll.addEventListener('click', () => {
  state.filter = 'all';
  renderInbox();
});
elements.filterPage.addEventListener('click', () => {
  state.filter = 'page';
  renderInbox();
});

elements.glossaryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const term = elements.glossaryTerm.value.trim();
  if (!term) return;
  const normalized = term.toLowerCase();
  if (state.glossary.some((entry) => entry.term?.toLowerCase() === normalized)) {
    setStatus(`术语「${term}」已在术语表中。`, true);
    return;
  }
  const next = [...state.glossary, {
    id: `ext-glossary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    term,
    aliases: [],
    explanation: elements.glossaryExplanation.value.trim(),
    updatedAt: Date.now(),
  }];
  await chrome.storage.local.set({ [GLOSSARY_KEY]: next });
  state.glossary = next;
  elements.glossaryForm.reset();
  setStatus('');
  renderGlossary();
});

elements.sendInbox.addEventListener('click', async () => {
  elements.sendInbox.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: 'anchorread-send-inbox' }).catch(() => null);
  if (response?.ok) {
    setStatus('已打开 AnchorRead 接收回流；页面确认接收后收件箱自动清空。');
  } else {
    setStatus(response?.error || '回流失败，请确认 AnchorRead 实例正在运行。', true);
    elements.sendInbox.disabled = state.inbox.length === 0;
  }
});

// 收件箱在 AnchorRead 确认接收后由 background 清空，这里同步刷新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[INBOX_KEY]) {
    state.inbox = Array.isArray(changes[INBOX_KEY].newValue) ? changes[INBOX_KEY].newValue : [];
    renderInbox();
    if (state.inbox.length === 0 && elements.statusLine.textContent.startsWith('已打开')) {
      setStatus('AnchorRead 已确认接收，收件箱已清空。');
    }
  }
  if (changes[GLOSSARY_KEY]) {
    state.glossary = Array.isArray(changes[GLOSSARY_KEY].newValue) ? changes[GLOSSARY_KEY].newValue : [];
    renderGlossary();
  }
});

(async function init() {
  await Promise.all([loadState(), loadCurrentTabUrl()]);
  render();
})();
