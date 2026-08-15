/**
 * API Key 鉴权（服务端）
 * 设置环境变量 ANCHORREAD_API_KEY 后，所有 /api/* 请求必须携带
 * `x-api-key` 头或 `Authorization: Bearer <key>`；未设置时保持本地免鉴权。
 */

import { timingSafeEqual } from 'node:crypto';

export function getApiKey() {
  return String(process.env.ANCHORREAD_API_KEY || '').trim();
}

export function isApiAuthEnabled() {
  return getApiKey().length > 0;
}

/** 恒定时间字符串比较，避免时序侧信道泄露 Key */
function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a), 'utf8');
  const bufferB = Buffer.from(String(b), 'utf8');
  if (bufferA.length !== bufferB.length) {
    // 长度不同时也与自身比较一次，保持耗时接近
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export function extractProvidedApiKey(request) {
  const headerKey = request?.headers?.get?.('x-api-key');
  if (headerKey && headerKey.trim()) return headerKey.trim();
  const authorization = request?.headers?.get?.('authorization') || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/iu);
  return bearerMatch ? bearerMatch[1].trim() : '';
}

/**
 * 校验请求是否允许通过
 * @returns {Response|null} 返回 Response 表示拒绝（401），null 表示放行
 */
export function authorizeApiRequest(request) {
  if (!isApiAuthEnabled()) return null;
  const provided = extractProvidedApiKey(request);
  if (provided && safeEqual(provided, getApiKey())) return null;
  return new Response(
    JSON.stringify({ error: 'API Key 无效或缺失。请通过 x-api-key 头或 Authorization: Bearer 携带。' }),
    { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8', 'WWW-Authenticate': 'Bearer' } }
  );
}
