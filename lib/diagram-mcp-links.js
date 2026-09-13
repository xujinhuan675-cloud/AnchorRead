import { parseExcalidrawScene } from './excalidraw-scene.js';
import { createDefaultPresentation } from './diagram-stream.js';
import { normalizePresentationSpec } from './diagram-presentation.js';
import { resolveAnchorReadPublicOrigin } from './diagram-public-origin.js';
import { serializeDiagramAgentError } from './diagram-agent-protocol.js';
import { preflightDiagramScene } from './diagram-scene-quality.js';

export function sanitizeDiagramBrowserUrl(value, { fallbackPath = '/diagrams', ...originOptions } = {}) {
  const origin = resolveAnchorReadPublicOrigin({ baseUrl: value, ...originOptions });
  const source = String(value?.url || value || '').trim();
  if (!source) return `${origin}${fallbackPath}`;
  try {
    const parsed = new URL(source, origin);
    if (!/^\/diagrams(?:\/|$)/u.test(parsed.pathname)) return `${origin}${fallbackPath}`;
    return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return `${origin}${fallbackPath}`;
  }
}

export function buildDiagramUrl(routeId, { baseUrl = '', fallbackToDefault = true, ...originOptions } = {}) {
  const normalizedRouteId = String(routeId || '').trim();
  if (!normalizedRouteId) return '';
  const origin = resolveAnchorReadPublicOrigin({ baseUrl, fallbackToDefault, ...originOptions });
  const path = `/diagrams/${encodeURIComponent(normalizedRouteId)}`;
  return origin ? `${origin}${path}` : path;
}

export function buildDiagramWorkspaceUrl({ baseUrl = '', fallbackToDefault = true, ...originOptions } = {}) {
  const origin = resolveAnchorReadPublicOrigin({ baseUrl, fallbackToDefault, ...originOptions });
  return origin ? `${origin}/diagrams` : '/diagrams';
}

export function createDiagramResourceLink({ routeId, title, url = '' } = {}) {
  const normalizedRouteId = String(routeId || '').trim();
  const fallbackPath = normalizedRouteId ? `/diagrams/${encodeURIComponent(normalizedRouteId)}` : '/diagrams';
  const resourceUrl = url
    ? sanitizeDiagramBrowserUrl(url, { fallbackPath })
    : buildDiagramUrl(normalizedRouteId);
  if (!resourceUrl) return null;
  const label = String(title || 'AnchorRead 图解').trim() || 'AnchorRead 图解';
  return {
    type: 'resource_link',
    uri: resourceUrl,
    name: normalizedRouteId || 'anchorread-diagrams',
    title: `在 AnchorRead 中打开：${label}`,
    description: 'AnchorRead 图解页面。图解数据保存在用户默认浏览器的 IndexedDB 中，链接本身不上传或携带 scene；具备打开 URL 能力的 AI 客户端应在用户的默认浏览器中打开此链接，其他客户端可将其展示给用户。',
    mimeType: 'text/html',
  };
}

export function createWorkspaceResourceLink({ url = '' } = {}) {
  const resourceUrl = sanitizeDiagramBrowserUrl(url, { fallbackPath: '/diagrams' });
  return {
    type: 'resource_link',
    uri: resourceUrl,
    name: 'anchorread-diagram-workspace',
    title: '打开 AnchorRead 图解工作区',
    description: 'AnchorRead 图解工作区。图解数据保存在用户默认浏览器的 IndexedDB 中；具备打开 URL 能力的 AI 客户端应在用户的默认浏览器中打开此链接。',
    mimeType: 'text/html',
  };
}

export function createMcpBrowserRecoveryResult(error, { baseUrl = '' } = {}) {
  const code = String(error?.code || '').trim();
  if (!['BROWSER_SESSION_OFFLINE', 'BRIDGE_TIMEOUT', 'BROWSER_BUILD_STALE'].includes(code)) return null;
  const url = buildDiagramWorkspaceUrl({ baseUrl });
  const recovery = {
    ok: false,
    code,
    error: String(error?.message || error || 'AnchorRead browser workspace is offline.'),
    ...(error?.expected ? { expected: error.expected } : {}),
    ...(error?.actual ? { actual: error.actual } : {}),
    nextAction: code === 'BROWSER_BUILD_STALE' ? 'refresh_workspace_page_then_retry' : 'open_diagram_workspace_then_retry',
    url,
    openRequested: true,
    openAction: 'open_url_if_supported',
    openTarget: 'default_browser',
    openResource: { kind: 'workspace', url },
  };
  return {
    ...createMcpToolResult(recovery),
    structuredContent: recovery,
  };
}

export function createMcpToolResult(value) {
  if (value && Array.isArray(value.content)) return value;
  const structuredContent = value?.structuredContent !== undefined
    ? value.structuredContent
    : (value && typeof value === 'object' && !Array.isArray(value) ? value : undefined);
  const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const serializedBytes = new TextEncoder().encode(serialized).byteLength;
  const text = structuredContent !== undefined && serializedBytes > 16_384
    ? JSON.stringify({
        ok: value?.ok,
        code: value?.code,
        id: value?.id,
        routeId: value?.routeId,
        revision: value?.revision,
        operationId: value?.operationId,
        structuredContentBytes: serializedBytes,
        note: 'Large payload is available once in structuredContent.',
      }, null, 2)
    : serialized;
  const content = [{
    type: 'text',
    text,
  }];
  const resource = value?.openResource;
  if (resource?.kind === 'workspace') content.push(createWorkspaceResourceLink(resource));
  if (resource?.kind === 'diagram') content.push(createDiagramResourceLink(resource));
  // MCP Apps may receive only the result channel (instead of ontoolinput).
  // Preserve object results there so the embedded canvas can hydrate the
  // same scene that was persisted/opened in the browser. Explicit structured
  // content remains authoritative when a caller supplies it.
  return {
    content: content.filter(Boolean),
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

export function createMcpErrorResult(error) {
  const payload = { ok: false, ...serializeDiagramAgentError(error) };
  return { ...createMcpToolResult(payload), isError: true };
}

export function createInlineViewResult({ elements, title = 'Excalidraw', presentation = null } = {}) {
  let parsed = elements;
  if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  if (!Array.isArray(parsed)) throw new Error('create_view elements 必须是 JSON 数组。');
  const scene = parseExcalidrawScene(parsed);
  const preflight = preflightDiagramScene(scene);
  const normalizedPresentation = presentation == null
    ? createDefaultPresentation(scene.elements)
    : normalizePresentationSpec(presentation);
  return {
    title,
    engine: 'excalidraw',
    elements: scene.elements,
    scene,
    source: JSON.stringify(scene.elements),
    ...(normalizedPresentation ? { presentation: normalizedPresentation } : {}),
    preflight,
    ...(preflight.warnings.length > 0 ? { qualityWarnings: preflight.warnings } : {}),
    openRequested: false,
    openAction: 'none',
  };
}

/**
 * Return the inline view payload in both MCP text and structured channels.
 * MCP Apps normally receive tool arguments through ontoolinput, but some
 * hosts expose only the tool result to the embedded app. The structured
 * channel provides a safe, typed fallback without parsing arbitrary text.
 */
export function createInlineViewToolResult(args = {}) {
  const view = createInlineViewResult(args);
  return {
    ...createMcpToolResult(view),
    structuredContent: view,
  };
}
