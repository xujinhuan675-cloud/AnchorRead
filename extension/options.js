const DEFAULT_BASE_URL = 'http://localhost:3000';

const baseUrlInput = document.getElementById('baseUrl');
const accessPasswordInput = document.getElementById('accessPassword');
const apiKeyInput = document.getElementById('apiKey');
const saveButton = document.getElementById('save');
const status = document.getElementById('status');

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

async function restore() {
  const { anchorReadBaseUrl, anchorReadAccessPassword, anchorReadApiKey } = await chrome.storage.sync.get([
    'anchorReadBaseUrl',
    'anchorReadAccessPassword',
    'anchorReadApiKey',
  ]);
  baseUrlInput.value = anchorReadBaseUrl || DEFAULT_BASE_URL;
  accessPasswordInput.value = anchorReadAccessPassword || '';
  apiKeyInput.value = anchorReadApiKey || '';
}

/** 非本机地址需要追加 host 权限，才能让后台 fetch 绕过 CORS 调用 API */
async function ensureHostPermission(baseUrl) {
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return false;
  }
  if (['http://localhost', 'http://127.0.0.1'].includes(origin)) return true;
  const pattern = `${origin}/*`;
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

/** 连通性自检：/api/openapi 无鉴权，只验证实例可达 */
async function probe(baseUrl, apiKey) {
  const headers = {};
  if (apiKey) headers['x-api-key'] = apiKey;
  const response = await fetch(`${baseUrl}/api/openapi`, { headers });
  return response.ok;
}

async function save() {
  let value = baseUrlInput.value.trim().replace(/\/+$/, '');
  if (value && !/^https?:\/\//i.test(value)) {
    setStatus('地址必须以 http:// 或 https:// 开头', true);
    return;
  }
  if (!value) value = DEFAULT_BASE_URL;

  const granted = await ensureHostPermission(value);
  await chrome.storage.sync.set({
    anchorReadBaseUrl: value,
    anchorReadAccessPassword: accessPasswordInput.value.trim(),
    anchorReadApiKey: apiKeyInput.value.trim(),
  });
  baseUrlInput.value = value;

  try {
    const reachable = await probe(value, apiKeyInput.value.trim());
    if (!granted) {
      setStatus('已保存，但未授予该地址的访问权限，原地解读与回流将不可用', true);
    } else if (reachable) {
      setStatus('已保存，连接正常');
    } else {
      setStatus('已保存，但实例响应异常，请检查地址与服务状态', true);
    }
  } catch (error) {
    setStatus(`已保存，但无法连接实例：${error?.message || error}`, true);
  }
  setTimeout(() => setStatus(''), 6000);
}

saveButton.addEventListener('click', save);
restore();
