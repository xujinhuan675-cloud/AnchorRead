const DEFAULT_PUBLIC_URL = 'https://anchorread.flowguide.cc';

function runtimeOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  if (typeof process !== 'undefined' && process.env?.ANCHORREAD_PUBLIC_URL) return process.env.ANCHORREAD_PUBLIC_URL;
  return '';
}

function normalizedOrigin(value = '') {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    return new URL(source).origin;
  } catch {
    return '';
  }
}

export function buildDiagramUrl(routeId, { baseUrl = '', fallbackToDefault = true } = {}) {
  const normalizedRouteId = String(routeId || '').trim();
  if (!normalizedRouteId) return '';
  const origin = normalizedOrigin(baseUrl)
    || normalizedOrigin(runtimeOrigin())
    || (fallbackToDefault ? DEFAULT_PUBLIC_URL : '');
  const path = `/diagrams/${encodeURIComponent(normalizedRouteId)}`;
  return origin ? `${origin}${path}` : path;
}

export function buildDiagramWorkspaceUrl({ baseUrl = '', fallbackToDefault = true } = {}) {
  const origin = normalizedOrigin(baseUrl)
    || normalizedOrigin(runtimeOrigin())
    || (fallbackToDefault ? DEFAULT_PUBLIC_URL : '');
  return origin ? `${origin}/diagrams` : '/diagrams';
}

export function createDiagramResourceLink({ routeId, title, url = '' } = {}) {
  const normalizedRouteId = String(routeId || '').trim();
  const resourceUrl = String(url || '').trim() || buildDiagramUrl(normalizedRouteId);
  if (!resourceUrl) return null;
  const label = String(title || 'AnchorRead 图解').trim() || 'AnchorRead 图解';
  return {
    type: 'resource_link',
    uri: resourceUrl,
    name: normalizedRouteId || 'anchorread-diagrams',
    title: `在 AnchorRead 中打开：${label}`,
    description: 'AnchorRead 图解页面。具备浏览器控制能力的 AI 客户端应打开此链接；其他客户端可将其展示给用户。',
    mimeType: 'text/html',
  };
}

export function createWorkspaceResourceLink({ url = '' } = {}) {
  const resourceUrl = String(url || '').trim() || buildDiagramWorkspaceUrl();
  return {
    type: 'resource_link',
    uri: resourceUrl,
    name: 'anchorread-diagram-workspace',
    title: '打开 AnchorRead 图解工作区',
    description: 'AnchorRead 图解工作区。具备浏览器控制能力的 AI 客户端应打开此链接。',
    mimeType: 'text/html',
  };
}

export function createMcpBrowserRecoveryResult(error, { baseUrl = '' } = {}) {
  const code = String(error?.code || '').trim();
  if (!['BROWSER_SESSION_OFFLINE', 'BRIDGE_TIMEOUT'].includes(code)) return null;
  const url = buildDiagramWorkspaceUrl({ baseUrl });
  return createMcpToolResult({
    ok: false,
    code,
    error: String(error?.message || error || 'AnchorRead browser workspace is offline.'),
    nextAction: 'open_diagram_workspace_then_retry',
    url,
    openAction: 'open_url_if_supported',
    openResource: { kind: 'workspace', url },
  });
}

export function createMcpToolResult(value) {
  if (value && Array.isArray(value.content)) return value;
  const content = [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }];
  const resource = value?.openResource;
  if (resource?.kind === 'workspace') content.push(createWorkspaceResourceLink(resource));
  if (resource?.kind === 'diagram') content.push(createDiagramResourceLink(resource));
  return { content: content.filter(Boolean) };
}
