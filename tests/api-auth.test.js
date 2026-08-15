/**
 * API Key 鉴权契约测试
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { authorizeApiRequest, extractProvidedApiKey, isApiAuthEnabled } = await import('../lib/api-auth.js');

function makeRequest(headers = {}) {
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { headers: { get: (key) => map.get(String(key).toLowerCase()) ?? null } };
}

test('未设置 ANCHORREAD_API_KEY 时免鉴权放行', () => {
  delete process.env.ANCHORREAD_API_KEY;
  assert.equal(isApiAuthEnabled(), false);
  assert.equal(authorizeApiRequest(makeRequest()), null);
});

test('设置 Key 后缺失凭证返回 401', async () => {
  process.env.ANCHORREAD_API_KEY = 'secret-key-123';
  const denied = authorizeApiRequest(makeRequest());
  assert.ok(denied);
  assert.equal(denied.status, 401);
  const payload = await denied.json();
  assert.match(payload.error, /API Key/);
  delete process.env.ANCHORREAD_API_KEY;
});

test('x-api-key 头正确时放行', () => {
  process.env.ANCHORREAD_API_KEY = 'secret-key-123';
  assert.equal(authorizeApiRequest(makeRequest({ 'x-api-key': 'secret-key-123' })), null);
  delete process.env.ANCHORREAD_API_KEY;
});

test('Authorization Bearer 正确时放行', () => {
  process.env.ANCHORREAD_API_KEY = 'secret-key-123';
  assert.equal(authorizeApiRequest(makeRequest({ authorization: 'Bearer secret-key-123' })), null);
  delete process.env.ANCHORREAD_API_KEY;
});

test('错误 Key 返回 401', () => {
  process.env.ANCHORREAD_API_KEY = 'secret-key-123';
  const denied = authorizeApiRequest(makeRequest({ 'x-api-key': 'wrong' }));
  assert.ok(denied);
  assert.equal(denied.status, 401);
  delete process.env.ANCHORREAD_API_KEY;
});

test('extractProvidedApiKey 优先取 x-api-key', () => {
  assert.equal(
    extractProvidedApiKey(makeRequest({ 'x-api-key': 'a', authorization: 'Bearer b' })),
    'a'
  );
  assert.equal(extractProvidedApiKey(makeRequest({ authorization: 'Bearer b' })), 'b');
  assert.equal(extractProvidedApiKey(makeRequest()), '');
});
