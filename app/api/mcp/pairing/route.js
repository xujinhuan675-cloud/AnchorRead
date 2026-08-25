import { NextResponse } from 'next/server';
import { getDiagramAgentTransport } from '@/lib/diagram-agent-transport';
import {
  getDiagramMcpPairingStore,
  getDiagramMcpRuntimeInfo,
} from '@/lib/diagram-mcp-pairing-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sameOriginBrowserRequest(request) {
  try {
    const url = new URL(request.url);
    if (new Set(['localhost', '127.0.0.1', '::1']).has(url.hostname.toLowerCase())) return true;
    const origin = String(request.headers.get('origin') || '').trim();
    if (origin) return origin === url.origin;
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
    managementSecret: request.headers.get('x-anchorread-session-secret'),
  };
}

function errorStatus(code) {
  if (['PAIRING_FORBIDDEN', 'SESSION_CONFLICT'].includes(code)) return 403;
  if (code === 'CONNECTION_REPLACED') return 409;
  if (code === 'TOKEN_NOT_FOUND') return 404;
  if (['BROWSER_SESSION_OFFLINE', 'PAIRING_STORE_UNAVAILABLE'].includes(code)) return 503;
  if (code === 'TOKEN_LIMIT_REACHED') return 429;
  return 400;
}

function jsonError(error) {
  const code = String(error?.code || 'PAIRING_ERROR');
  return NextResponse.json({
    ok: false,
    code,
    error: String(error?.message || error),
  }, { status: errorStatus(code) });
}

async function testBrowserRoute(store, context) {
  const connection = await store.assertConnectionOwner(context);
  const timeoutMs = 8_000;
  const transport = getDiagramAgentTransport();
  const { id, promise } = await transport.createRequest(
    { tool: 'list_diagrams', args: {} },
    {
      ttlMs: timeoutMs,
      scope: {
        workspaceId: connection.workspaceId,
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
          transport.cancelRequest(id, error);
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
  const context = contextFrom(request, body);
  const action = String(body?.action || '').trim();
  try {
    if (action === 'register') {
      const connection = await store.registerConnection(context, { replace: body?.replace === true });
      return NextResponse.json({
        ok: true,
        connection,
        runtime: { ...getDiagramMcpRuntimeInfo(), ...getDiagramAgentTransport().runtimeInfo },
      });
    }
    if (action === 'disconnect') {
      const disconnected = await store.disconnectConnection(context);
      return NextResponse.json({ ok: true, disconnected });
    }
    if (action === 'status') {
      const snapshot = await store.snapshot(context);
      return NextResponse.json({
        ok: true,
        ...snapshot,
        runtime: { ...snapshot.runtime, ...getDiagramAgentTransport().runtimeInfo },
      });
    }
    if (action === 'create-token') {
      const created = await store.createToken(context, {
        name: body?.name,
      });
      return NextResponse.json({ ok: true, ...created, tokens: await store.listTokens(context) });
    }
    if (action === 'revoke-token') {
      const token = await store.revokeToken(context, body?.tokenId);
      await getDiagramAgentTransport().cancelRequestsForToken(token.id);
      return NextResponse.json({ ok: true, token, tokens: await store.listTokens(context) });
    }
    if (action === 'rotate-token') {
      const rotated = await store.rotateToken(context, body?.tokenId, {
        name: body?.name,
      });
      await getDiagramAgentTransport().cancelRequestsForToken(rotated.previous.id);
      return NextResponse.json({ ok: true, ...rotated, tokens: await store.listTokens(context) });
    }
    if (action === 'test') {
      const tested = await testBrowserRoute(store, context);
      return NextResponse.json({ ok: true, testedAt: Date.now(), ...tested });
    }
    return NextResponse.json({ ok: false, code: 'UNKNOWN_ACTION', error: `Unsupported pairing action: ${action}` }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
