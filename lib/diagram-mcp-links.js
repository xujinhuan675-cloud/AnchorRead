import { parseExcalidrawScene } from './excalidraw-scene.js';
import { createDefaultMermaidPresentation, createDefaultPresentation } from './diagram-stream.js';
import { normalizePresentationSpec } from './diagram-presentation.js';
import { resolveAnchorReadPublicOrigin } from './diagram-public-origin.js';

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
    description: 'AnchorRead 图解页面。具备浏览器控制能力的 AI 客户端应打开此链接；其他客户端可将其展示给用户。',
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
    description: 'AnchorRead 图解工作区。具备浏览器控制能力的 AI 客户端应打开此链接。',
    mimeType: 'text/html',
  };
}

export function createMcpBrowserRecoveryResult(error, { baseUrl = '' } = {}) {
  const code = String(error?.code || '').trim();
  if (!['BROWSER_SESSION_OFFLINE', 'BRIDGE_TIMEOUT'].includes(code)) return null;
  const url = buildDiagramWorkspaceUrl({ baseUrl });
  const recovery = {
    ok: false,
    code,
    error: String(error?.message || error || 'AnchorRead browser workspace is offline.'),
    nextAction: 'open_diagram_workspace_then_retry',
    url,
    openRequested: true,
    openAction: 'open_url_if_supported',
    openResource: { kind: 'workspace', url },
  };
  return {
    ...createMcpToolResult(recovery),
    structuredContent: recovery,
  };
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
  const structuredContent = value?.structuredContent;
  return {
    content: content.filter(Boolean),
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

export function createInlineViewResult({ elements, title = 'Excalidraw', presentation = null } = {}) {
  let parsed = elements;
  if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  if (!Array.isArray(parsed)) throw new Error('create_view elements 必须是 JSON 数组。');
  const scene = parseExcalidrawScene(parsed);
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

export function createInlineDiagramResult(args = {}, error, { baseUrl = '' } = {}) {
  const hasExcalidrawInput = args.scene !== undefined || args.elements !== undefined;
  const engine = args.engine === 'mermaid' ? 'mermaid' : (args.engine === 'excalidraw' || hasExcalidrawInput ? 'excalidraw' : 'mermaid');
  const title = String(args.title || 'AnchorRead 图解').trim() || 'AnchorRead 图解';
  const hasElements = args.elements !== undefined || args.scene !== undefined;
  const source = typeof args.source === 'string' ? args.source.trim() : '';
  if (!hasElements && !source) return null;
  const note = `浏览器工作区当前不可用，已在对话画布中直接渲染。${error?.message ? `（${error.message}）` : ''}`;
  const url = buildDiagramWorkspaceUrl({ baseUrl });
  const recovery = {
    url,
    openRequested: args.open !== false,
    openAction: 'open_url_if_supported',
    openResource: { kind: 'workspace', url },
  };
  if (engine === 'mermaid') {
    return source ? {
      title,
      engine,
      scene: null,
      source,
      presentation: args.presentation == null
        ? createDefaultMermaidPresentation(source)
        : normalizePresentationSpec(args.presentation),
      ...recovery,
      note,
    } : null;
  }
  try {
    const scene = parseExcalidrawScene(args.elements ?? args.scene);
    return {
      title,
      engine,
      scene,
      elements: scene.elements,
      source: JSON.stringify(scene.elements),
      presentation: args.presentation == null
        ? createDefaultPresentation(scene.elements)
        : normalizePresentationSpec(args.presentation),
      ...recovery,
      note,
    };
  } catch {
    return null;
  }
}
