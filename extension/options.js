const DEFAULT_BASE_URL = 'http://localhost:3000';

const input = document.getElementById('baseUrl');
const saveButton = document.getElementById('save');
const status = document.getElementById('status');

async function restore() {
  const { anchorReadBaseUrl } = await chrome.storage.sync.get('anchorReadBaseUrl');
  input.value = anchorReadBaseUrl || DEFAULT_BASE_URL;
}

async function save() {
  let value = input.value.trim().replace(/\/+$/, '');
  if (value && !/^https?:\/\//i.test(value)) {
    status.textContent = '地址必须以 http:// 或 https:// 开头';
    return;
  }
  if (!value) value = DEFAULT_BASE_URL;
  await chrome.storage.sync.set({ anchorReadBaseUrl: value });
  input.value = value;
  status.textContent = '已保存';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

saveButton.addEventListener('click', save);
restore();
