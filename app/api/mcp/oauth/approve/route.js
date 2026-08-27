import { NextResponse } from 'next/server';
import { getDiagramMcpOAuthStore } from '@/lib/diagram-mcp-oauth';
import { getDiagramMcpPairingStore } from '@/lib/diagram-mcp-pairing-store';
import { isSameOriginBrowserRequest } from '@/lib/diagram-mcp-oauth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  if (code === 'BROWSER_SESSION_OFFLINE') return 503;
  return 400;
}

export async function POST(request) {
  if (!isSameOriginBrowserRequest(request)) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', error: 'OAuth browser approval is only available to the same-origin AnchorRead browser.' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const context = contextFrom(request, body);
    const pairingStore = getDiagramMcpPairingStore();
    // Register the current browser before issuing the code. This both proves
    // the management secret and gives the later MCP token a workspace target.
    const connection = await pairingStore.registerConnection(context, { replace: true });
    const approved = getDiagramMcpOAuthStore().approveTransaction(body?.transaction, context);
    return NextResponse.json({ ok: true, ...approved, connection }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const code = String(error?.code || 'OAUTH_APPROVAL_FAILED');
    return NextResponse.json({ ok: false, code, error: String(error?.message || error) }, { status: errorStatus(code) });
  }
}
