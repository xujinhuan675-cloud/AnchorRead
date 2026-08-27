import { NextResponse } from 'next/server';

export function requestOrigin(request) {
  const url = new URL(request.url);
  const forwardedHost = String(request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  const forwardedProto = String(request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  if (forwardedHost) {
    const protocol = forwardedProto || url.protocol.replace(':', '');
    return `${protocol}://${forwardedHost}`;
  }
  return url.origin;
}

export function oauthHeaders(contentType = 'application/json') {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': `${contentType}; charset=utf-8`,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  };
}

export function oauthJson(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), { status, headers: oauthHeaders() });
}

export function oauthErrorResponse(error) {
  const code = String(error?.code || 'invalid_request');
  const status = Number(error?.status) || (code === 'invalid_client' ? 401 : 400);
  return oauthJson({ error: code, error_description: String(error?.message || error) }, { status });
}

export function oauthOptions() {
  return new NextResponse(null, { status: 204, headers: oauthHeaders() });
}

export function isSameOriginBrowserRequest(request) {
  try {
    const url = new URL(request.url);
    if (new Set(['localhost', '127.0.0.1', '::1']).has(url.hostname.toLowerCase())) return true;
    const origin = String(request.headers.get('origin') || '').trim();
    if (origin) {
      if (origin === requestOrigin(request)) return true;
      const originUrl = new URL(origin);
      return originUrl.origin === requestOrigin(request);
    }
    return request.headers.get('sec-fetch-site') === 'same-origin';
  } catch {
    return false;
  }
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
