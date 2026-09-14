import { NextResponse } from 'next/server';
import { getDiagramAgentTransport } from '@/lib/diagram-agent-transport';
import { getDiagramMcpPairingStore } from '@/lib/diagram-mcp-pairing-store';
import { withApiObservability } from '@/lib/api-observability';
import { createBrowserBuildStaleError, serializeDiagramAgentError } from '@/lib/diagram-agent-protocol';
import { createDiagramAgentRequestTiming } from '@/lib/diagram-agent-timing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PRESENCE_TIMEOUT_MS = 3_000;

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

function bearerToken(request) {
  const value = String(request.headers.get('authorization') || '').trim();
  const match = /^Bearer\s+(.+)$/iu.exec(value);
  return match ? String(match[1] || '').trim() : '';
}

async function authenticatePersonalSubmit(request) {
  const secret = bearerToken(request);
  if (!secret) return null;
  try {
    const authenticated = await getDiagramMcpPairingStore().authenticateToken(secret);
    // Personal tokens are the only bearer credentials accepted by the
    // remote bridge endpoint. OAuth access tokens remain scoped to /mcp.
    return authenticated?.token?.kind === 'personal' ? authenticated : null;
  } catch {
    return null;
  }
}

function jsonError(message, status = 400, code = 'BRIDGE_ERROR', details = {}) {
  return NextResponse.json({ ok: false, error: message, code, ...details }, { status });
}

function pairingContext(request, values = {}) {
  return {
    workspaceId: values.workspaceId || '',
    browserSessionId: values.browserSessionId || '',
    tabId: values.tabId || '',
    clientId: values.clientId || '',
    href: values.href || '',
    buildSha: values.buildSha || '',
    buildVersion: values.buildVersion || '',
    protocolVersion: values.protocolVersion || '',
    managementSecret: request.headers.get('x-anchorread-session-secret') || '',
  };
}

async function freshBindingInfo(store, context) {
  await store.settle?.();
  await store.refreshIfChanged?.();
  return store.getBindingInfo(context);
}

function pairingError(error) {
  const code = String(error?.code || 'PAIRING_ERROR');
  const unavailable = ['BROWSER_SESSION_OFFLINE', 'BROKER_BUSY', 'BROKER_CONFIG_ERROR', 'BROKER_UNAVAILABLE'].includes(code);
  const status = ['CONNECTION_REPLACED', 'BROWSER_BUILD_STALE'].includes(code) ? 409 : (unavailable ? 503 : 403);
  const details = serializeDiagramAgentError(error);
  delete details.code;
  delete details.message;
  return jsonError(String(error?.message || error), status, code, details);
}

async function readPresence(transport, scope) {
  const presencePromise = Promise.resolve(transport.getPresence(scope));
  let timer;
  try {
    return await Promise.race([
      presencePromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error('AnchorRead browser presence check timed out. Open the diagram workspace and retry.'),
          { code: 'BROWSER_SESSION_OFFLINE' },
        )), PRESENCE_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isBrokerError(error) {
  return ['BROKER_BUSY', 'BROKER_CONFIG_ERROR', 'BROKER_UNAVAILABLE'].includes(String(error?.code || ''));
}

function withRoutingHeaders(handler) {
  return async function routedDiagramAgentHandler(request) {
    let response;
    try {
      response = await handler(request);
    } catch (error) {
      if (!isBrokerError(error)) throw error;
      response = pairingError(error);
    }
    let runtime = {};
    try {
      runtime = getDiagramAgentTransport().runtimeInfo || {};
    } catch (error) {
      if (!isBrokerError(error)) throw error;
      if (!response || response.status < 400) response = pairingError(error);
      runtime = {
        instanceId: process.env.ANCHORREAD_INSTANCE_ID || 'unknown',
        requestBroker: String(process.env.ANCHORREAD_DIAGRAM_BROKER || 'memory'),
      };
    }
    response.headers.set('X-AnchorRead-Instance-Id', runtime.instanceId || 'unknown');
    response.headers.set('X-AnchorRead-Request-Broker', runtime.requestBroker || 'memory');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
}

async function handleGET(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'poll';
  if (!authorized(request, action)) return jsonError('Diagram bridge authorization failed.', 401, 'UNAUTHORIZED');
  const clientId = url.searchParams.get('clientId') || '';
  const tabId = url.searchParams.get('tabId') || '';
  const workspaceId = url.searchParams.get('workspaceId') || '';
  const browserSessionId = url.searchParams.get('browserSessionId') || '';
  const visible = url.searchParams.get('visible') !== 'false';
  const focused = url.searchParams.get('focused') !== 'false';
  const href = url.searchParams.get('href') || '';
  const buildSha = url.searchParams.get('buildSha') || '';
  const buildVersion = url.searchParams.get('buildVersion') || '';
  const protocolVersion = url.searchParams.get('protocolVersion') || '';
  const context = pairingContext(request, { clientId, tabId, workspaceId, browserSessionId, href, buildSha, buildVersion, protocolVersion });
  const store = getDiagramMcpPairingStore();
  const transport = getDiagramAgentTransport();
  if (action === 'register') {
    try {
      const connection = await store.registerConnection(context, { replace: false });
      await store.assertConnectionOwner(context);
      return NextResponse.json({
        ok: true,
        connection,
        client: await transport.registerClient(clientId, { tabId, workspaceId, bindingId: connection.bindingId, browserSessionId, visible, focused, href, buildSha, buildVersion, protocolVersion }),
      });
    } catch (error) {
      return pairingError(error);
    }
  }
  if (action === 'unregister') {
    try {
      let disconnected = false;
      let bindingId = '';
      if (transport.runtimeInfo?.sharedRequestBroker) {
        const binding = await freshBindingInfo(store, context);
        bindingId = binding.bindingId;
        disconnected = await store.disconnectConnection(context).catch((error) => {
          if (error?.code === 'BROWSER_SESSION_OFFLINE') return false;
          throw error;
        });
      } else {
        disconnected = await store.disconnectConnection(context);
      }
      return NextResponse.json({
        ok: true,
        disconnected,
        removed: await transport.unregisterClient(clientId, { ...context, bindingId }),
      });
    } catch (error) {
      return pairingError(error);
    }
  }
  if (action !== 'poll') return jsonError(`Unsupported diagram bridge GET action: ${action}`);
  let connection;
  try {
    connection = await store.registerConnection(context, { replace: false });
    await store.assertConnectionOwner(context);
  } catch (error) {
    return pairingError(error);
  }
  const waitMs = Math.max(0, Math.min(Number(url.searchParams.get('waitMs')) || 0, 25_000));
  const client = { tabId, workspaceId, bindingId: connection.bindingId, browserSessionId, visible, focused, href, buildSha, buildVersion, protocolVersion };
  const requests = waitMs
    ? await transport.waitForRequests(clientId, { waitMs, client })
    : await transport.claimRequests(clientId, { client });
  return NextResponse.json({ ok: true, connection, requests });
}

async function handlePOST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Diagram bridge expects a JSON request body.');
  }
  const action = String(body?.action || '');
  let personalAuth = null;
  if (!authorized(request, action)) {
    personalAuth = action === 'submit' ? await authenticatePersonalSubmit(request) : null;
    if (!personalAuth) return jsonError('Diagram bridge authorization failed.', 401, 'UNAUTHORIZED');
  }
  if (action === 'submit') {
    const command = body?.request;
    if (!command || typeof command !== 'object' || !command.tool) {
      return jsonError('A diagram bridge request must include tool and args.');
    }
    try {
      const transport = getDiagramAgentTransport();
      const requestedScope = body?.scope && typeof body.scope === 'object' ? body.scope : {};
      const scope = personalAuth
        ? {
            ...requestedScope,
            workspaceId: requestedScope.workspaceId || personalAuth.binding.workspaceId,
            bindingId: requestedScope.bindingId || personalAuth.binding.bindingId,
          }
        : requestedScope;
      if (personalAuth && (scope.workspaceId !== personalAuth.binding.workspaceId || scope.bindingId !== personalAuth.binding.bindingId)) {
        return jsonError('Personal token scope does not match the requested browser workspace.', 403, 'BROWSER_BINDING_MISMATCH');
      }
      if (typeof transport.getPresence === 'function') {
        const presence = await readPresence(transport, scope);
        if (!presence || presence.online !== true) {
          throw Object.assign(new Error('No open AnchorRead browser is paired with this workspace. Open the diagram workspace and retry.'), { code: 'BROWSER_SESSION_OFFLINE' });
        }
        if (presence?.online === true && presence?.versionCompatible === false) {
          throw createBrowserBuildStaleError(presence.actual || presence, { workspaceUrl: presence.href });
        }
        if (presence.connected === false || presence.writable === false) {
          if (presence.status === 'stale') {
            throw createBrowserBuildStaleError(presence.actual || presence, { workspaceUrl: presence.href });
          }
          throw Object.assign(new Error('The paired AnchorRead browser is not writable. Refresh the workspace page and retry.'), { code: 'BROWSER_SESSION_OFFLINE' });
        }
      }
      const timing = createDiagramAgentRequestTiming({
        timeoutMs: body?.timeoutMs,
        ttlMs: body?.ttlMs,
      });
      const { id, promise } = await transport.createRequest(command, {
        ttlMs: timing.ttlMs,
        scope,
        tokenId: personalAuth?.token?.id || '',
      });
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('The AnchorRead browser did not complete the diagram request before timeout.');
          error.code = 'BRIDGE_TIMEOUT';
          Promise.resolve(transport.cancelRequest(id, error)).catch(() => {});
          reject(error);
        }, timing.timeoutMs);
        timer.unref?.();
      });
      try {
        const result = await Promise.race([promise, timeout]);
        return NextResponse.json({ ok: true, requestId: id, result });
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const status = error?.code === 'BRIDGE_QUEUE_FULL' ? 429 : (error?.code === 'BROWSER_BUILD_STALE' ? 409 : 504);
      const details = serializeDiagramAgentError(error);
      delete details.code;
      delete details.message;
      return jsonError(String(error?.message || error), status, error?.code || 'BRIDGE_ERROR', details);
    }
  }
  if (action === 'resolve') {
    const context = pairingContext(request, body);
    const transport = getDiagramAgentTransport();
    let bindingId = '';
    try {
      if (transport.runtimeInfo?.sharedRequestBroker) {
        const pairingStore = getDiagramMcpPairingStore();
        bindingId = (await freshBindingInfo(pairingStore, context)).bindingId;
      } else {
        await getDiagramMcpPairingStore().assertConnectionOwner(context);
      }
    } catch (error) {
      return pairingError(error);
    }
    const accepted = await transport.resolveRequest(
      body?.id,
      body?.claimToken,
      body?.error ? undefined : body?.result,
      body?.error,
      { client: { ...context, bindingId } },
    );
    if (!accepted) return jsonError('Unknown or already resolved diagram bridge request.', 409, 'STALE_REQUEST');
    return NextResponse.json({ ok: true });
  }
  return jsonError(`Unsupported diagram bridge action: ${action}`);
}

export const GET = withApiObservability('diagram.bridge.get', withRoutingHeaders(handleGET));
export const POST = withApiObservability('diagram.bridge.post', withRoutingHeaders(handlePOST));
