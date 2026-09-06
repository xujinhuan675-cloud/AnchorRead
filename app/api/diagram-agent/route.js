import { NextResponse } from 'next/server';
import { getDiagramAgentTransport } from '@/lib/diagram-agent-transport';
import { getDiagramMcpPairingStore } from '@/lib/diagram-mcp-pairing-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requestHostname(request) {
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLoopback(request) {
  return new Set(['localhost', '127.0.0.1', '::1']).has(requestHostname(request));
}

function isSameOriginBrowserRequest(request) {
  const origin = String(request.headers.get('origin') || '').trim();
  if (origin) {
    try {
      const requestUrl = new URL(request.url);
      if (origin === requestUrl.origin) return true;
      const originUrl = new URL(origin);
      const forwardedHost = String(request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
      const host = forwardedHost || String(request.headers.get('host') || '').split(',')[0].trim();
      const forwardedProto = String(request.headers.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
      if (!host || originUrl.host !== host) return false;
      return !forwardedProto || originUrl.protocol === `${forwardedProto}:`;
    } catch {
      return false;
    }
  }
  // Fetch metadata headers are browser-controlled and cannot be set by a
  // cross-origin page. Same-origin polling therefore works on a deployed
  // AnchorRead host without opening the queue to arbitrary servers.
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

function authorized(request, action) {
  // Poll/resolve are browser-side operations. They may run on the deployed
  // AnchorRead origin, while command submission remains token protected.
  const remoteBridgeEnabled = String(process.env.ANCHORREAD_DIAGRAM_REMOTE_BRIDGE || '').toLowerCase() === 'true';
  if (!isLoopback(request) && remoteBridgeEnabled && ['poll', 'register', 'unregister', 'resolve'].includes(action) && isSameOriginBrowserRequest(request)) return true;
  if (!isLoopback(request)) return false;
  const expected = String(process.env.ANCHORREAD_DIAGRAM_BRIDGE_TOKEN || '').trim();
  const supplied = String(request.headers.get('x-anchorread-bridge-token') || '').trim();
  if (['poll', 'register', 'unregister', 'resolve'].includes(action)) return true;
  if (expected) return supplied === expected;
  return true;
}

function jsonError(message, status = 400, code = 'BRIDGE_ERROR') {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

function pairingContext(request, values = {}) {
  return {
    workspaceId: values.workspaceId || '',
    browserSessionId: values.browserSessionId || '',
    tabId: values.tabId || '',
    clientId: values.clientId || '',
    href: values.href || '',
    managementSecret: request.headers.get('x-anchorread-session-secret') || '',
  };
}

function pairingError(error) {
  const code = String(error?.code || 'PAIRING_ERROR');
  const status = code === 'CONNECTION_REPLACED' ? 409 : (code === 'BROWSER_SESSION_OFFLINE' ? 503 : 403);
  return jsonError(String(error?.message || error), status, code);
}

async function queueWakeRequest(body) {
  const command = body?.request;
  if (!command || typeof command !== 'object' || !command.tool) {
    return jsonError('A diagram bridge request must include tool and args.');
  }
  try {
    const transport = getDiagramAgentTransport();
    const { id, promise } = await transport.createRequest(command, {
      ttlMs: body?.ttlMs || 2 * 60_000,
      wakeOnly: true,
    });
    promise.catch(() => {});
    return NextResponse.json({ ok: true, requestId: id });
  } catch (error) {
    const status = error?.code === 'BRIDGE_QUEUE_FULL' ? 429 : 503;
    return jsonError(String(error?.message || error), status, error?.code || 'BRIDGE_ERROR');
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'poll';
  if (!authorized(request, action)) return jsonError('Diagram bridge authorization failed.', 401, 'UNAUTHORIZED');
  const clientId = url.searchParams.get('clientId') || '';
  const tabId = url.searchParams.get('tabId') || '';
  const workspaceId = url.searchParams.get('workspaceId') || '';
  const browserSessionId = url.searchParams.get('browserSessionId') || '';
  const visible = url.searchParams.get('visible') !== 'false';
  const focused = url.searchParams.get('focused') !== 'false';
  const wakeRequestId = url.searchParams.get('wakeRequestId') || '';
  const href = url.searchParams.get('href') || '';
  const context = pairingContext(request, { clientId, tabId, workspaceId, browserSessionId, href });
  const store = getDiagramMcpPairingStore();
  const transport = getDiagramAgentTransport();
  if (action === 'register') {
    try {
      const connection = await store.registerConnection(context, { replace: false });
      return NextResponse.json({
        ok: true,
        connection,
        client: await transport.registerClient(clientId, { tabId, workspaceId, browserSessionId, visible, focused, href }),
      });
    } catch (error) {
      return pairingError(error);
    }
  }
  if (action === 'unregister') {
    try {
      const disconnected = await store.disconnectConnection(context);
      return NextResponse.json({ ok: true, disconnected, removed: await transport.unregisterClient(clientId) });
    } catch (error) {
      return pairingError(error);
    }
  }
  if (action !== 'poll') return jsonError(`Unsupported diagram bridge GET action: ${action}`);
  if (!wakeRequestId) {
    try {
      await store.registerConnection(context, { replace: false });
    } catch (error) {
      return pairingError(error);
    }
  }
  const waitMs = Math.max(0, Math.min(Number(url.searchParams.get('waitMs')) || 0, 25_000));
  const requests = waitMs
    ? await transport.waitForRequests(clientId, { waitMs, wakeRequestId, client: { tabId, workspaceId, browserSessionId, visible, focused, href } })
    : await transport.claimRequests(clientId, { wakeRequestId, client: { tabId, workspaceId, browserSessionId, visible, focused, href } });
  return NextResponse.json({ ok: true, requests });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Diagram bridge expects a JSON request body.');
  }
  const action = String(body?.action || '');
  if (!authorized(request, action)) return jsonError('Diagram bridge authorization failed.', 401, 'UNAUTHORIZED');
  if (action === 'submit') {
    const command = body?.request;
    if (!command || typeof command !== 'object' || !command.tool) {
      return jsonError('A diagram bridge request must include tool and args.');
    }
    try {
      const transport = getDiagramAgentTransport();
      const { id, promise } = await transport.createRequest(command, { ttlMs: body?.ttlMs });
      const timeoutMs = Math.max(1_000, Math.min(Number(body?.timeoutMs) || 45_000, 120_000));
      const timeout = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          const error = new Error('No open AnchorRead browser claimed the diagram request before timeout.');
          error.code = 'BRIDGE_TIMEOUT';
          transport.cancelRequest(id, error);
          reject(error);
        }, timeoutMs);
        timer.unref?.();
      });
      const result = await Promise.race([promise, timeout]);
      return NextResponse.json({ ok: true, requestId: id, result });
    } catch (error) {
      const status = error?.code === 'BRIDGE_QUEUE_FULL' ? 429 : 504;
      return jsonError(String(error?.message || error), status, error?.code || 'BRIDGE_ERROR');
    }
  }
  if (action === 'queue') return queueWakeRequest(body);
  if (action === 'resolve') {
    const wakeRequestId = String(body?.wakeRequestId || '').trim();
    if (!wakeRequestId || wakeRequestId !== String(body?.id || '').trim()) {
      try {
        await getDiagramMcpPairingStore().assertConnectionOwner(pairingContext(request, body));
      } catch (error) {
        return pairingError(error);
      }
    }
    const accepted = await getDiagramAgentTransport().resolveRequest(
      body?.id,
      body?.claimToken,
      body?.error ? undefined : body?.result,
      body?.error,
    );
    if (!accepted) return jsonError('Unknown or already resolved diagram bridge request.', 409, 'STALE_REQUEST');
    return NextResponse.json({ ok: true });
  }
  return jsonError(`Unsupported diagram bridge action: ${action}`);
}
