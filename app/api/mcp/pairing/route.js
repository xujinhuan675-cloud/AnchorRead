import { NextResponse } from 'next/server';
import { getDiagramAgentTransport } from '@/lib/diagram-agent-transport';
import { getDiagramMcpOAuthStore } from '@/lib/diagram-mcp-oauth';
import {
  getDiagramMcpPairingStore,
  getDiagramMcpRuntimeInfo,
} from '@/lib/diagram-mcp-pairing-store';
import { serializeDiagramAgentError } from '@/lib/diagram-agent-protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sameOriginBrowserRequest(request) {
  try {
    const url = new URL(request.url);
    if (new Set(['localhost', '127.0.0.1', '::1']).has(url.hostname.toLowerCase())) return true;
    const origin = String(request.headers.get('origin') || '').trim();
    if (origin) {
      if (origin === url.origin) return true;
      const originUrl = new URL(origin);
      const forwardedHost = String(request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
      const host = forwardedHost || String(request.headers.get('host') || '').split(',')[0].trim();
      const forwardedProto = String(request.headers.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
      if (!host || originUrl.host !== host) return false;
      return !forwardedProto || originUrl.protocol === `${forwardedProto}:`;
    }
    return request.headers.get('sec-fetch-site') === 'same-origin';
  } catch {
    return false;
  }
}

function contextFrom(request, body) {
  return {
    workspaceId: body?.workspaceId,
    browserSessionId: body?.browserSessionId,
    tabId: body?.tabId,
    clientId: body?.clientId,
    href: body?.href,
    buildSha: body?.buildSha,
    buildVersion: body?.buildVersion,
    protocolVersion: body?.protocolVersion,
    managementSecret: request.headers.get('x-anchorread-session-secret'),
  };
}

async function freshBindingInfo(store, context) {
  await store.settle?.();
  await store.refreshIfChanged?.();
  return store.getBindingInfo(context);
}

function errorStatus(code) {
  if (['PAIRING_FORBIDDEN', 'SESSION_CONFLICT'].includes(code)) return 403;
  if (code === 'CONNECTION_REPLACED') return 409;
  if (code === 'BROWSER_BUILD_STALE') return 409;
  if (['BROWSER_SESSION_OFFLINE', 'PAIRING_STORE_UNAVAILABLE', 'BROKER_BUSY', 'BROKER_CONFIG_ERROR', 'BROKER_UNAVAILABLE'].includes(code)) return 503;
  if (code === 'TOKEN_NOT_FOUND') return 404;
  return 400;
}

function jsonError(error) {
  const code = String(error?.code || 'PAIRING_ERROR');
  const serialized = serializeDiagramAgentError(error);
  return NextResponse.json({ ok: false, error: serialized.message, ...serialized }, { status: errorStatus(code) });
}

async function testBrowserRoute(store, context) {
  const transport = getDiagramAgentTransport();
  const connection = transport.runtimeInfo?.sharedRequestBroker
    ? await freshBindingInfo(store, context)
    : await store.assertConnectionOwner(context);
  const timeoutMs = 8_000;
  const { id, promise } = await transport.createRequest(
    { tool: 'verify_browser_connection', args: {} },
    {
      ttlMs: timeoutMs,
      scope: {
        workspaceId: connection.workspaceId,
        bindingId: connection.bindingId,
        browserSessionId: connection.browserSessionId,
        tabId: connection.tabId,
      },
    },
  );
  let timer;
  try {
    const result = await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('The paired browser did not answer the connection test.');
          error.code = 'BRIDGE_TIMEOUT';
          Promise.resolve(transport.cancelRequest(id, error)).catch(() => {});
          reject(error);
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
    return { requestId: id, result };
  } finally {
    clearTimeout(timer);
  }
}

async function authorizationSnapshot(pairingStore, oauthStore, context) {
  const binding = await freshBindingInfo(pairingStore, context);
  const tokenSnapshot = await pairingStore.listTokensForBinding(context);
  return {
    binding,
    authorizations: oauthStore.listAuthorizations(binding),
    accessTokens: tokenSnapshot.tokens.filter((token) => token.status === 'active'),
  };
}

async function sharedConnectionSnapshot(store, transport, context) {
  if (!transport.runtimeInfo?.sharedRequestBroker || typeof transport.getPresence !== 'function') {
    return store.snapshot(context);
  }
  const binding = await freshBindingInfo(store, context);
  const presence = await transport.getPresence({
    workspaceId: binding.workspaceId,
    bindingId: binding.bindingId,
  });
  return {
    connection: presence ? {
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      ...presence,
      currentClient: !context.clientId || presence.clientId === context.clientId,
    } : {
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      browserSessionId: binding.browserSessionId,
      connected: false,
      currentClient: false,
      status: 'disconnected',
    },
    runtime: store.runtimeInfo,
  };
}

export async function POST(request) {
  if (!sameOriginBrowserRequest(request)) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', error: 'Pairing is only available to the same-origin AnchorRead browser.' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'INVALID_JSON', error: 'Pairing expects a JSON body.' }, { status: 400 });
  }

  const store = getDiagramMcpPairingStore();
  const oauthStore = getDiagramMcpOAuthStore();
  const context = contextFrom(request, body);
  const action = String(body?.action || '').trim();
  try {
    if (action === 'register') {
      const transport = getDiagramAgentTransport();
      await transport.assertReady?.();
      const connection = await store.registerConnection(context, { replace: body?.replace === true });
      await store.assertConnectionOwner(context);
      return NextResponse.json({
        ok: true,
        connection,
        runtime: { ...getDiagramMcpRuntimeInfo(), ...transport.runtimeInfo },
      });
    }
    if (action === 'heartbeat') {
      const connection = await store.registerConnection(context, { replace: false });
      await store.assertConnectionOwner(context);
      return NextResponse.json({
        ok: true,
        heartbeat: true,
        connection,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'disconnect') {
      const disconnected = await store.disconnectConnection(context);
      return NextResponse.json({ ok: true, disconnected });
    }
    if (action === 'status') {
      const transport = getDiagramAgentTransport();
      const snapshot = await sharedConnectionSnapshot(store, transport, context);
      return NextResponse.json({
        ok: true,
        ...snapshot,
        runtime: { ...snapshot.runtime, ...transport.runtimeInfo },
      });
    }
    if (action === 'test') {
      const tested = await testBrowserRoute(store, context);
      return NextResponse.json({ ok: true, testedAt: Date.now(), ...tested });
    }
    if (action === 'authorizations') {
      const snapshot = await authorizationSnapshot(store, oauthStore, context);
      return NextResponse.json({ ok: true, ...snapshot }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'revoke-authorizations') {
      const clientId = String(body?.clientId || '').trim();
      const tokenId = String(body?.tokenId || '').trim();
      const binding = await freshBindingInfo(store, context);
      const revokedTokens = await store.revokeTokensForBinding(context, { clientId, tokenId });
      const refreshTokensRevoked = oauthStore.revokeAuthorizations(binding, { clientId });
      const transport = getDiagramAgentTransport();
      for (const token of revokedTokens.tokens) await transport.cancelRequestsForToken(token.id);
      const snapshot = await authorizationSnapshot(store, oauthStore, context);
      return NextResponse.json({
        ok: true,
        ...snapshot,
        revokedTokens: revokedTokens.tokens,
        refreshTokensRevoked,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ ok: false, code: 'UNKNOWN_ACTION', error: `Unsupported pairing action: ${action}` }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
