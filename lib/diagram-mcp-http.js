import {
  DIAGRAM_MCP_READ_ME,
  DIAGRAM_MCP_INSTRUCTIONS,
  DIAGRAM_MCP_PROTOCOL_VERSION,
  DIAGRAM_MCP_SERVER_INFO,
  DIAGRAM_MCP_SUPPORTED_PROTOCOL_VERSIONS,
  getDiagramMcpTools,
} from './diagram-agent-mcp-contract.js';
import { getDiagramAgentTransport } from './diagram-agent-transport.js';
import {
  getDiagramMcpPairingStore,
} from './diagram-mcp-pairing-store.js';
import { getDiagramMcpOAuthResourceMetadataUrl } from './diagram-mcp-authorization.js';
import {
  buildDiagramWorkspaceUrl,
  createMcpBrowserRecoveryResult,
  createMcpToolResult,
  createInlineDiagramResult,
  createInlineViewToolResult,
} from './diagram-mcp-links.js';
import {
  DIAGRAM_MCP_APP_RESOURCE_URI,
  diagramMcpAppResourceListing,
  readDiagramMcpAppResource,
} from './diagram-mcp-app-resource.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SESSION_KEY = Symbol.for('anchor-read.diagram-mcp-http-sessions');
const MAX_SESSIONS = 128;
const SESSION_TTL_MS = 30 * 60 * 1000;

function state() {
  if (!globalThis[SESSION_KEY]) globalThis[SESSION_KEY] = new Map();
  return globalThis[SESSION_KEY];
}

export function isLoopbackRequest(request) {
  try {
    return LOCAL_HOSTS.has(new URL(request.url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function extractBearer(request) {
  const authorization = String(request.headers.get('authorization') || '');
  const match = authorization.match(/^Bearer\s+(.+)$/iu);
  return match ? match[1].trim() : '';
}

function allowedOrigins() {
  return String(process.env.ANCHORREAD_MCP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isAllowedMcpOrigin(request) {
  const origin = String(request.headers.get('origin') || '').trim();
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  let requestOrigin = '';
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (origin === requestOrigin) return true;
  const configured = allowedOrigins();
  return configured.includes('*') || configured.includes(origin);
}

export async function authorizeMcpRequest(request) {
  if (!isAllowedMcpOrigin(request)) {
    return { ok: false, status: 403, code: 'ORIGIN_NOT_ALLOWED', message: 'MCP request origin is not allowed.' };
  }
  const supplied = extractBearer(request);
  if (!supplied && isLoopbackRequest(request)) return { ok: true, local: true, token: null, binding: null };
  if (!supplied) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'MCP authentication failed. Complete the AnchorRead OAuth flow.' };
  }
  try {
    const authenticated = await getDiagramMcpPairingStore().authenticateToken(supplied);
    return { ok: true, local: false, ...authenticated };
  } catch (error) {
    const unavailable = error?.code === 'PAIRING_STORE_UNAVAILABLE';
    return { ok: false, status: unavailable ? 503 : 401, code: error?.code || 'UNAUTHORIZED', message: String(error?.message || error) };
  }
}

export function mcpCorsHeaders(request) {
  const headers = {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
    Vary: 'Origin',
  };
  const origin = String(request.headers.get('origin') || '').trim();
  if (origin && isAllowedMcpOrigin(request)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function pruneSessions(now = Date.now()) {
  const sessions = state();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
  }
  return sessions;
}

function sessionId() {
  const suffix = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `anchorread-${suffix}`;
}

export function createMcpSession({ protocolVersion, clientInfo, auth = null } = {}) {
  const sessions = pruneSessions();
  const id = sessionId();
  const now = Date.now();
  sessions.set(id, {
    id,
    protocolVersion,
    clientInfo: clientInfo || null,
    auth,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return sessions.get(id);
}

export function getMcpSession(id, { touch = true } = {}) {
  const session = pruneSessions().get(String(id || ''));
  if (!session) return null;
  if (touch) {
    session.lastSeenAt = Date.now();
    session.expiresAt = session.lastSeenAt + SESSION_TTL_MS;
  }
  return session;
}

export function deleteMcpSession(id) {
  return pruneSessions().delete(String(id || ''));
}

export function getMcpSessionCount() {
  return pruneSessions().size;
}

export function getMcpSessionId(request) {
  return String(request.headers.get('mcp-session-id') || '').trim();
}

export function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

export const MCP_SESSION_TTL_MS = SESSION_TTL_MS;

function textResult(value) {
  return createMcpToolResult(value);
}

function timeoutValue(value) {
  const configured = Number(value);
  return Math.max(1_000, Math.min(Number.isFinite(configured) && configured > 0 ? configured : 90_000, 120_000));
}

/**
 * Submit a command to a browser bridge living in this AnchorRead process.
 * The queue itself remains transport-neutral and is also used by local STDIO.
 */
export async function submitDiagramTool(tool, args, {
  timeoutMs = timeoutValue(process.env.ANCHORREAD_DIAGRAM_BRIDGE_TIMEOUT_MS),
  signal,
  binding = null,
  tokenId = '',
} = {}) {
  if (binding && !binding.connected) {
    const error = new Error('The browser workspace paired with this token is offline. Open its AnchorRead diagram tab and retry.');
    error.code = 'BROWSER_SESSION_OFFLINE';
    throw error;
  }
  const transport = getDiagramAgentTransport();
  const { id, promise } = await transport.createRequest({ tool, args }, {
    ttlMs: timeoutMs,
    scope: binding ? {
      workspaceId: binding.workspaceId,
      browserSessionId: binding.browserSessionId,
      tabId: binding.tabId,
    } : null,
    tokenId,
  });
  let timer;
  let abortHandler;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('No open AnchorRead browser claimed the diagram request before timeout.');
      error.code = 'BRIDGE_TIMEOUT';
      transport.cancelRequest(id, error);
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });
  const aborted = new Promise((_, reject) => {
    if (!signal) return;
    abortHandler = () => {
      const error = new Error('MCP client disconnected before the diagram request completed.');
      error.code = 'MCP_CLIENT_ABORTED';
      transport.cancelRequest(id, error);
      reject(error);
    };
    if (signal.aborted) abortHandler();
    else signal.addEventListener('abort', abortHandler, { once: true });
  });
  try {
    return await Promise.race([promise, timeout, aborted]);
  } finally {
    clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
  }
}

function selectProtocolVersion(request, params = {}) {
  const requested = String(params.protocolVersion || request.headers.get('mcp-protocol-version') || '').trim();
  if (DIAGRAM_MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
  return DIAGRAM_MCP_PROTOCOL_VERSION;
}

function responseFor(request, body, { status = 200, sessionId: id, contentType = 'application/json' } = {}) {
  const runtime = getDiagramMcpPairingStore().runtimeInfo || {};
  const headers = {
    ...mcpCorsHeaders(request),
    'Content-Type': `${contentType}; charset=utf-8`,
    'X-AnchorRead-Routing-Mode': runtime.persistentTokens ? 'single-process-persistent-oauth' : 'single-process-memory',
  };
  if (id) {
    headers['MCP-Session-Id'] = id;
    headers['MCP-Protocol-Version'] = getMcpSession(id)?.protocolVersion || DIAGRAM_MCP_PROTOCOL_VERSION;
  }
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function responseError(request, id, status, code, message, headers = {}) {
  const response = responseFor(request, jsonRpcError(id, code, message), { status, sessionId: id });
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

async function parseRpcRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    const error = new Error('MCP endpoint expects a JSON-RPC request body.');
    error.code = 'INVALID_JSON';
    throw error;
  }
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    const error = new Error('MCP endpoint expects one JSON-RPC 2.0 request.');
    error.code = 'INVALID_REQUEST';
    throw error;
  }
  return body;
}

/**
 * Minimal MCP Streamable HTTP handler. It intentionally uses Web Response
 * objects so both Next route handlers and node-level tests can exercise the
 * same protocol behavior.
 */
export async function handleDiagramMcpHttpRequest(request, {
  submitTool = submitDiagramTool,
  includeExport = false,
} = {}) {
  const cors = mcpCorsHeaders(request);
  if (request.method === 'OPTIONS') {
    if (!isAllowedMcpOrigin(request)) return responseError(request, null, 403, -32001, 'MCP request origin is not allowed.');
    return new Response(null, { status: 204, headers: cors });
  }

  const auth = await authorizeMcpRequest(request);
  if (!auth.ok) {
    const authorizationHeader = auth.status === 401
      ? `Bearer resource_metadata="${getDiagramMcpOAuthResourceMetadataUrl(request)}"`
      : '';
    const response = responseError(request, null, auth.status, -32001, auth.message, {
      'WWW-Authenticate': authorizationHeader,
    });
    return response;
  }

  if (request.method === 'GET') {
    // SSE is optional in Streamable HTTP. Returning 405 tells clients to use
    // the request/response POST transport instead of pretending to stream.
    return responseError(request, getMcpSessionId(request) || null, 405, -32000, 'This MCP endpoint does not expose a server-sent event stream.', { Allow: 'POST, DELETE, OPTIONS' });
  }
  if (request.method === 'DELETE') {
    const id = getMcpSessionId(request);
    const session = id ? getMcpSession(id, { touch: false }) : null;
    if (!session) return new Response(null, { status: 404, headers: { ...cors, Allow: 'POST, DELETE, OPTIONS' } });
    if ((session.auth?.tokenId || '') !== (auth.token?.id || '')) {
      return responseError(request, id, 401, -32001, 'MCP session authentication does not match the Bearer token.');
    }
    deleteMcpSession(id);
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST') {
    return responseError(request, null, 405, -32000, `Unsupported MCP HTTP method: ${request.method}`, { Allow: 'POST, DELETE, OPTIONS' });
  }

  let rpc;
  try {
    rpc = await parseRpcRequest(request);
  } catch (error) {
    return responseError(request, null, 400, -32600, error.message);
  }

  const sessionHeader = getMcpSessionId(request);
  let session = sessionHeader ? getMcpSession(sessionHeader) : null;
  if (rpc.method === 'initialize') {
    if (sessionHeader && !session) return responseError(request, sessionHeader, 404, -32001, 'Unknown or expired MCP session.');
    if (session && (session.auth?.tokenId || '') !== (auth.token?.id || '')) {
      return responseError(request, sessionHeader, 401, -32001, 'MCP session authentication does not match the Bearer token.');
    }
    session = session || createMcpSession({
      protocolVersion: selectProtocolVersion(request, rpc.params),
      clientInfo: rpc.params?.clientInfo,
      auth: auth.token ? {
        tokenId: auth.token.id,
        workspaceId: auth.binding.workspaceId,
        browserSessionId: auth.binding.browserSessionId,
      } : null,
    });
    const result = {
      protocolVersion: session.protocolVersion,
      capabilities: { tools: {}, resources: {} },
      serverInfo: DIAGRAM_MCP_SERVER_INFO,
      instructions: DIAGRAM_MCP_INSTRUCTIONS,
    };
    return responseFor(request, { jsonrpc: '2.0', id: rpc.id ?? null, result }, { sessionId: session.id });
  }
  if (!session) return responseError(request, sessionHeader || null, 400, -32000, 'MCP-Session-Id is required after initialize.');
  if ((session.auth?.tokenId || '') !== (auth.token?.id || '')) {
    return responseError(request, session.id, 401, -32001, 'MCP session authentication does not match the Bearer token.');
  }

  if (rpc.method === 'notifications/initialized' || rpc.method === 'notifications/cancelled') {
    return new Response(null, { status: 202, headers: { ...mcpCorsHeaders(request), 'MCP-Session-Id': session.id } });
  }
  if (rpc.method === 'ping') return responseFor(request, { jsonrpc: '2.0', id: rpc.id ?? null, result: {} }, { sessionId: session.id });
  if (rpc.method === 'tools/list') {
    return responseFor(request, { jsonrpc: '2.0', id: rpc.id ?? null, result: { tools: getDiagramMcpTools({ includeExport }) } }, { sessionId: session.id });
  }
  if (rpc.method === 'resources/list') {
    return responseFor(request, {
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      result: { resources: [diagramMcpAppResourceListing()] },
    }, { sessionId: session.id });
  }
  if (rpc.method === 'resources/read') {
    const uri = String(rpc.params?.uri || '').trim();
    if (uri !== DIAGRAM_MCP_APP_RESOURCE_URI) {
      return responseError(request, session.id, 200, -32602, `Unknown MCP App resource: ${uri}`);
    }
    return responseFor(request, {
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      result: { contents: [readDiagramMcpAppResource()] },
    }, { sessionId: session.id });
  }
  if (rpc.method !== 'tools/call') {
    return responseError(request, session.id, 200, -32601, `Method not found: ${rpc.method}`);
  }

  const name = String(rpc.params?.name || '').trim();
  const knownTool = getDiagramMcpTools({ includeExport }).some((tool) => tool.name === name);
  if (!knownTool) {
    return responseFor(request, { jsonrpc: '2.0', id: rpc.id ?? null, result: { content: [{ type: 'text', text: `Unknown diagram tool: ${name}` }], isError: true } }, { sessionId: session.id });
  }
  if (name === 'open_diagram_workspace') {
    return responseFor(request, {
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      result: textResult({
        url: buildDiagramWorkspaceUrl({ baseUrl: request.url }),
        opened: false,
        openAction: 'open_url_if_supported',
        openResource: { kind: 'workspace' },
      }),
    }, { sessionId: session.id });
  }
  try {
    const args = rpc.params?.arguments || {};
    const result = name === 'read_me'
      ? { name: 'anchor-read-diagram', instructions: DIAGRAM_MCP_READ_ME }
      : name === 'create_view'
      ? createInlineViewToolResult(args)
      : await submitTool(name, args, {
        signal: request.signal,
        binding: auth.binding,
        tokenId: auth.token?.id || '',
      });
    return responseFor(request, {
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      result: name === 'create_view' ? result : textResult(result),
    }, { sessionId: session.id });
  } catch (error) {
    const browserUnavailable = ['BROWSER_SESSION_OFFLINE', 'BRIDGE_TIMEOUT'].includes(error?.code);
    const inline = name === 'create_diagram' && browserUnavailable
      ? createInlineDiagramResult(rpc.params?.arguments || {}, error)
      : null;
    if (inline) {
      return responseFor(request, { jsonrpc: '2.0', id: rpc.id ?? null, result: textResult(inline) }, { sessionId: session.id });
    }
    const recovery = createMcpBrowserRecoveryResult(error, { baseUrl: request.url });
    return responseFor(request, {
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      result: recovery ? { ...recovery, isError: true } : {
        content: [{ type: 'text', text: String(error?.message || error) }],
        isError: true,
      },
    }, { sessionId: session.id });
  }
}
