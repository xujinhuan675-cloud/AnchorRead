export const DIAGRAM_MCP_APP_RESOURCE_URI = 'ui://anchorread/diagram/mcp-app.html';
export const DIAGRAM_MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

const APP_CSP = Object.freeze({
  resourceDomains: ['https://esm.sh'],
  connectDomains: ['https://esm.sh'],
});

/**
 * Return the self-contained MCP App view. The host loads this HTML through
 * resources/read, so it does not need an AnchorRead browser tab or a public
 * asset URL. CDN imports are intentionally pinned to the versions used by
 * AnchorRead's own canvas.
 */
export function readDiagramMcpAppResource() {
  return {
    uri: DIAGRAM_MCP_APP_RESOURCE_URI,
    mimeType: DIAGRAM_MCP_APP_MIME_TYPE,
    text: String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AnchorRead 图解</title>
    <link rel="stylesheet" href="https://esm.sh/@excalidraw/excalidraw@0.18.0/dist/prod/index.css">
    <style>
      :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body, #root { margin: 0; width: 100%; min-height: 100%; }
      body { background: #fff; color: #292524; }
      .app-shell { position: relative; min-height: 460px; display: flex; flex-direction: column; }
      .app-shell.app-display-fullscreen { width: 100%; height: 100vh; min-height: 0; }
      .app-shell.app-display-fullscreen .app-canvas { height: auto; min-height: 0; }
      .app-toolbar { display: flex; align-items: center; gap: .5rem; padding: .45rem .7rem; border-bottom: 1px solid #e7e5e4; }
      .app-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #57534e; font-size: .78rem; font-weight: 500; }
      .app-toolbar-actions { display: flex; align-items: center; gap: .35rem; }
      .app-button { border: 1px solid #d6d3d1; border-radius: .4rem; background: #fff; color: #292524; padding: .42rem .65rem; font-size: .78rem; cursor: pointer; }
      .app-button:hover { background: #f5f5f4; }
      .app-button:disabled { cursor: default; opacity: .5; }
      .app-icon-button { width: 2rem; height: 2rem; display: grid; place-items: center; border: 1px solid #d6d3d1; border-radius: .4rem; background: #fff; color: #57534e; cursor: pointer; }
      .app-icon-button:hover { background: #f5f5f4; color: #292524; }
      .app-icon-button:focus-visible { outline: 2px solid #a8a29e; outline-offset: 1px; }
      .app-icon-button svg { width: 1rem; height: 1rem; }
      .app-canvas { position: relative; height: clamp(360px, 55vh, 620px); min-height: 360px; flex: 1 1 auto; }
      .app-canvas > .excalidraw { width: 100%; height: 100%; }
      .app-focus-mode .excalidraw .App-menu_top,
      .app-focus-mode .excalidraw .App-menu_bottom,
      .app-focus-mode .excalidraw .layer-ui__wrapper__top-right,
      .app-focus-mode .excalidraw .sidebar,
      .app-focus-mode .excalidraw .main-menu-trigger,
      .app-focus-mode .excalidraw .App-top-bar,
      .app-focus-mode .excalidraw .App-bottom-bar,
      .app-focus-mode .excalidraw .App-toolbar-content { display: none !important; }
      .app-empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 2rem; color: #78716c; font-size: .85rem; text-align: center; }
      .app-source { margin: 0; padding: 1rem; overflow: auto; color: #44403c; background: #fafaf9; font: .78rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
      .app-mermaid { min-height: 360px; overflow: auto; display: grid; place-items: center; padding: 1rem; background: #fff; }
      .app-mermaid svg { max-width: 100%; height: auto; }
      .app-preview { min-height: 360px; overflow: hidden; display: grid; place-items: center; padding: 1rem; background: #fff; }
      .app-preview svg { width: 100%; height: 100%; max-width: 100%; }
      .app-playback { position: absolute; right: .8rem; bottom: .8rem; z-index: 5; display: flex; align-items: center; gap: .2rem; padding: .2rem; border: 1px solid #d6d3d1; border-radius: .4rem; background: rgba(255,255,255,.94); box-shadow: 0 2px 8px rgba(28,25,23,.12); }
      .app-playback button { width: 2rem; height: 2rem; display: grid; place-items: center; border: 0; border-radius: .25rem; background: transparent; color: #44403c; cursor: pointer; }
      .app-playback button:hover { background: #f5f5f4; }
      .app-playback button:disabled { cursor: default; opacity: .35; }
      .app-playback button:disabled:hover { background: transparent; }
      .app-playback button:focus-visible { outline: 2px solid #a8a29e; outline-offset: 1px; }
      .app-playback button svg { width: 1rem; height: 1rem; }
      .app-playback span { min-width: 2.5rem; text-align: center; color: #57534e; font: .75rem ui-monospace, SFMono-Regular, Menlo, monospace; }
      .app-playback-select { max-width: 12rem; min-width: 7rem; border: 0; background: transparent; color: #57534e; font: .75rem system-ui, sans-serif; }
      .app-playback-select:focus-visible { outline: 2px solid #a8a29e; outline-offset: 1px; }
      .app-playback-collapsed .app-playback-secondary { display: none; }
      .app-playback-expand { border-left: 1px solid #e7e5e4 !important; border-radius: 0 !important; }
      @media (max-width: 520px) {
        .app-playback { right: .5rem; bottom: .5rem; max-width: calc(100% - 1rem); }
        .app-playback-expanded .app-playback-select { width: min(7rem, 30vw); min-width: 0; }
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      import React, { useEffect, useMemo, useRef, useState } from 'https://esm.sh/react@19.2.0';
      import { createRoot } from 'https://esm.sh/react-dom@19.2.0/client';
      import { useApp } from 'https://esm.sh/@modelcontextprotocol/ext-apps@0.4.0/react?deps=react@19.2.0,react-dom@19.2.0';
      import { Excalidraw, exportToSvg, convertToExcalidrawElements, FONT_FAMILY } from 'https://esm.sh/@excalidraw/excalidraw@0.18.0?deps=react@19.2.0,react-dom@19.2.0';
      import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, Maximize2, Minimize2, Pause, Pencil, Play, Square } from 'https://esm.sh/lucide-react@1.31.0?deps=react@19.2.0';
      import mermaid from 'https://esm.sh/mermaid@11.16.1';

      const PSEUDO_ELEMENT_TYPES = new Set(['cameraUpdate', 'delete', 'restoreCheckpoint']);

      function decodeJson(value, partial = false) {
        if (typeof value !== 'string') return { value, complete: true };
        const text = value.replace(/^\uFEFF/u, '').trim();
        if (!text) return { value: null, complete: !partial };
        try { return { value: JSON.parse(text), complete: true }; } catch {
          if (!partial || !text.startsWith('[')) return { value: null, complete: false };
          const lastObjectEnd = text.lastIndexOf('}');
          if (lastObjectEnd < 0) return { value: null, complete: false };
          try {
            const closed = JSON.parse(text.slice(0, lastObjectEnd + 1) + ']');
            return { value: closed, complete: false };
          } catch { return { value: null, complete: false }; }
        }
      }

      function excludeIncompleteLastItem(elements, partial) {
        if (!partial) return elements;
        if (elements.length < 2) return [];
        return elements.slice(0, -1);
      }

      function extractContent(value, { partial = false } = {}) {
        const decoded = decodeJson(value, partial);
        const parsed = decoded.value;
        if (Array.isArray(parsed)) {
          return { elements: parsed, complete: decoded.complete };
        }
        if (!parsed || typeof parsed !== 'object') return { elements: [], source: '', complete: decoded.complete };
        if (parsed.scene !== undefined) {
          const nested = extractContent(parsed.scene, { partial });
          return { ...nested, appState: parsed.appState || nested.appState, files: parsed.files || nested.files };
        }
        if (parsed.elements !== undefined) {
          const nested = extractContent(parsed.elements, { partial });
          return { ...nested, appState: parsed.appState || nested.appState, files: parsed.files || nested.files };
        }
        return {
          elements: [],
          source: typeof parsed.source === 'string' ? parsed.source : '',
          appState: parsed.appState,
          files: parsed.files,
          complete: decoded.complete,
        };
      }

      function convertRawElements(elements, partial = false) {
        if (!Array.isArray(elements)) return { elements: [], camera: null, complete: !partial };
        const closed = excludeIncompleteLastItem(elements, partial);
        const deletedIds = new Set();
        const realElements = [];
        let camera = null;
        for (const element of closed) {
          if (!element || typeof element !== 'object') continue;
          if (element.type === 'cameraUpdate') { camera = element; continue; }
          if (element.type === 'delete') {
            if (element.id) deletedIds.add(element.id);
            continue;
          }
          if (PSEUDO_ELEMENT_TYPES.has(element.type)) continue;
          realElements.push(element);
        }
        const survivors = realElements.filter((element) => !deletedIds.has(element.id));
        if (!survivors.length) return { elements: [], camera, complete: !partial };
        if (survivors.every((element) => Number.isFinite(element.version))) {
          return { elements: survivors, camera, complete: !partial };
        }
        try {
          const withDefaults = survivors.map((element) => element.label
            ? { ...element, label: { textAlign: 'center', verticalAlign: 'middle', ...element.label } }
            : element);
          const converted = convertToExcalidrawElements(withDefaults, { regenerateIds: false })
            .map((element) => element.type === 'text'
              ? { ...element, fontFamily: FONT_FAMILY.Excalifont ?? 1 }
              : element);
          return { elements: converted, camera, complete: !partial };
        } catch {
          return { elements: [], camera, complete: !partial };
        }
      }

      function cleanMermaidSvg(svg) {
        return String(svg || '')
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
          .replace(/javascript:/gi, '');
      }

      function defaultElementPresentation(elements) {
        const ids = (Array.isArray(elements) ? elements : [])
          .filter((element) => element?.id && !element.isDeleted && !(element.type === 'text' && element.containerId))
          .map((element) => element.id);
        return ids.map((_id, index) => ({
          id: 'step-' + (index + 1),
          title: '',
          durationMs: 500,
          transitionMs: 450,
          visibleElementIds: ids.slice(0, index + 1),
          focusElementIds: [_id],
        }));
      }

      function defaultMermaidPresentation(source) {
        const lines = String(source || '').split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith('%%'));
        return lines.map((_line, index) => ({
          id: 'mermaid-' + (index + 1),
          title: '',
          durationMs: 500,
          transitionMs: 450,
          visibleElementIds: lines.slice(0, index + 1).map((_item, itemIndex) => 'mermaid-' + (itemIndex + 1)),
          focusElementIds: ['mermaid-' + (index + 1)],
        }));
      }

      function normalizePresentation(value, fallback) {
        if (!value || typeof value !== 'object' || !Array.isArray(value.steps) || value.steps.length === 0) return fallback;
        return {
          title: String(value.title || ''),
          steps: value.steps.slice(0, 100).map((step, index) => ({
            id: String(step?.id || 'step-' + (index + 1)),
            title: String(step?.title || ''),
            durationMs: Number.isFinite(Number(step?.durationMs)) ? Math.max(0, Math.min(60000, Number(step.durationMs))) : 1200,
            transitionMs: Number.isFinite(Number(step?.transitionMs)) ? Math.max(0, Math.min(10000, Number(step.transitionMs))) : 450,
            visibleElementIds: Array.isArray(step?.visibleElementIds) ? [...new Set(step.visibleElementIds.map(String).filter(Boolean))] : [],
            focusElementIds: Array.isArray(step?.focusElementIds) ? [...new Set(step.focusElementIds.map(String).filter(Boolean))] : [],
            highlightElementIds: Array.isArray(step?.highlightElementIds) ? [...new Set(step.highlightElementIds.map(String).filter(Boolean))] : [],
            ...(step?.camera && typeof step.camera === 'object' ? { camera: step.camera } : {}),
          })),
        };
      }

      function resolveCameraTarget(camera, currentState) {
        const viewportWidth = Number(currentState?.width) || 0;
        const viewportHeight = Number(currentState?.height) || 0;
        const current = {
          scrollX: Number(currentState?.scrollX) || 0,
          scrollY: Number(currentState?.scrollY) || 0,
          zoom: Number(currentState?.zoom?.value) || 1,
        };
        if (camera?.region && viewportWidth > 0 && viewportHeight > 0) {
          const region = camera.region;
          const zoom = Math.min(viewportWidth / Number(region.width), viewportHeight / Number(region.height));
          return {
            zoom,
            scrollX: viewportWidth / 2 / zoom - (Number(region.x) || 0) - Number(region.width) / 2,
            scrollY: viewportHeight / 2 / zoom - (Number(region.y) || 0) - Number(region.height) / 2,
          };
        }
        return {
          scrollX: Number.isFinite(Number(camera?.scrollX)) ? Number(camera.scrollX) : current.scrollX,
          scrollY: Number.isFinite(Number(camera?.scrollY)) ? Number(camera.scrollY) : current.scrollY,
          zoom: Number.isFinite(Number(camera?.zoom)) && Number(camera.zoom) > 0 ? Number(camera.zoom) : current.zoom,
        };
      }

      function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

      function presentationTransitionDuration(step) {
        const requested = Number(step?.transitionMs);
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        return reducedMotion ? 0 : Math.max(0, Math.min(1200, Number.isFinite(requested) ? requested : 450));
      }

      function parseSvgViewBox(svg) {
        const values = String(svg?.getAttribute?.('viewBox') || '').trim().split(/[\s,]+/u).map(Number);
        if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) return { x: values[0], y: values[1], width: values[2], height: values[3] };
        return { x: 0, y: 0, width: Number(svg?.getAttribute?.('width')) || 1, height: Number(svg?.getAttribute?.('height')) || 1 };
      }

      function presentationIdMatches(item, id, index) {
        const value = String(id || '').trim();
        if (!value) return false;
        if (value === 'mermaid-' + (index + 1) || item?.id === value) return true;
        const descendants = item?.querySelectorAll?.('[id]');
        return Boolean(descendants && [...descendants].some((node) => node.id === value));
      }

      function matchingVisualItems(items, ids) {
        const requested = Array.isArray(ids) ? ids.filter(Boolean) : [];
        return requested.length ? items.filter((item, index) => requested.some((id) => presentationIdMatches(item, id, index))) : [];
      }

      function syntheticMermaidIds(ids) {
        return Array.isArray(ids) && ids.length > 0 && ids.every((id) => /^mermaid-\d+$/u.test(String(id)));
      }

      function visualItemsBounds(items) {
        const boxes = [];
        for (const item of items) {
          try {
            const box = item.getBBox?.();
            if (box && box.width > 0 && box.height > 0) boxes.push(box);
          } catch { /* Mermaid may not have mounted the geometry yet. */ }
        }
        if (!boxes.length) return null;
        const minX = Math.min(...boxes.map((box) => box.x));
        const minY = Math.min(...boxes.map((box) => box.y));
        const maxX = Math.max(...boxes.map((box) => box.x + box.width));
        const maxY = Math.max(...boxes.map((box) => box.y + box.height));
        const paddingX = Math.max(12, (maxX - minX) * 0.16);
        const paddingY = Math.max(12, (maxY - minY) * 0.16);
        return { x: minX - paddingX, y: minY - paddingY, width: Math.max(1, maxX - minX + paddingX * 2), height: Math.max(1, maxY - minY + paddingY * 2) };
      }

      function resolveMermaidViewBox(camera, base) {
        if (!base) return null;
        if (camera?.region && Number(camera.region.width) > 0 && Number(camera.region.height) > 0) {
          return { x: Number(camera.region.x) || 0, y: Number(camera.region.y) || 0, width: Number(camera.region.width), height: Number(camera.region.height) };
        }
        const zoom = Number(camera?.zoom);
        const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
        const width = base.width / scale;
        const height = base.height / scale;
        const offsetX = Number.isFinite(Number(camera?.scrollX)) ? Number(camera.scrollX) : 0;
        const offsetY = Number.isFinite(Number(camera?.scrollY)) ? Number(camera.scrollY) : 0;
        return { x: base.x + (base.width - width) / 2 - offsetX, y: base.y + (base.height - height) / 2 - offsetY, width, height };
      }

      function visibleElements(elements, step) {
        const source = Array.isArray(elements) ? elements : [];
        const visible = step?.visibleElementIds?.length ? new Set(step.visibleElementIds) : null;
        const highlighted = new Set(step?.highlightElementIds || []);
        return source.map((element) => {
          const isVisible = !visible || visible.has(element?.id) || (element?.containerId && visible.has(element.containerId));
          const isHighlighted = highlighted.has(element?.id) || (element?.containerId && highlighted.has(element.containerId));
          return {
            ...element,
            opacity: isVisible ? (element.opacity ?? 100) : 0,
            ...(isHighlighted ? { strokeColor: '#e11d48', strokeWidth: Math.max(2, Number(element.strokeWidth) || 1) } : {}),
          };
        });
      }

      function applyCameraUpdate(api, camera) {
        if (!api || typeof api.updateScene !== 'function') return;
        const appState = {};
        const scrollX = Number(camera.scrollX ?? camera.x);
        const scrollY = Number(camera.scrollY ?? camera.y);
        const zoom = Number(camera.zoom);
        if (Number.isFinite(scrollX)) appState.scrollX = scrollX;
        if (Number.isFinite(scrollY)) appState.scrollY = scrollY;
        if (Number.isFinite(zoom)) appState.zoom = { value: zoom };
        if (Object.keys(appState).length) api.updateScene({ appState });
      }

      function AnchorReadDiagramAppCore({ app, handlersRef, pendingEventsRef }) {
        const [elements, setElements] = useState([]);
        const [engine, setEngine] = useState('excalidraw');
        const [appState, setAppState] = useState({});
        const [files, setFiles] = useState({});
        const [title, setTitle] = useState('AnchorRead 图解');
        const [diagramUrl, setDiagramUrl] = useState('');
        const [source, setSource] = useState('');
        const [mermaidSvg, setMermaidSvg] = useState('');
        const [previewSvg, setPreviewSvg] = useState('');
        const [streaming, setStreaming] = useState(false);
        const [presentationIndex, setPresentationIndex] = useState(0);
        const [presentationActive, setPresentationActive] = useState(false);
        const [presentationPlaying, setPresentationPlaying] = useState(false);
        const [playbackExpanded, setPlaybackExpanded] = useState(false);
        const [editing, setEditing] = useState(false);
        const [displayMode, setDisplayMode] = useState(() => app.getHostContext?.()?.displayMode || 'inline');
        const [availableDisplayModes, setAvailableDisplayModes] = useState(() => app.getHostContext?.()?.availableDisplayModes || []);
        const [api, setApi] = useState(null);
        const [status, setStatus] = useState('等待图解输入');
        const apiRef = useRef(null);
        const presentationActiveRef = useRef(false);
        const lastAutoOpenedUrlRef = useRef('');
        const mermaidHostRef = useRef(null);
        const presentationAnimFrameRef = useRef(0);
        const baseViewBoxRef = useRef(null);
        const currentViewBoxRef = useRef(null);
        const [presentation, setPresentation] = useState(null);

        const presentationSteps = useMemo(() => {
          const fallback = engine === 'mermaid' ? defaultMermaidPresentation(source) : defaultElementPresentation(elements);
          return normalizePresentation(presentation, { title: '', steps: fallback })?.steps || fallback;
        }, [engine, elements, presentation, source]);
        const presentationStep = presentationSteps[presentationIndex] || null;
        const displayedElements = presentationActive && engine === 'excalidraw'
          ? visibleElements(elements, presentationStep)
          : elements;
        const displayedElementsKey = useMemo(() => JSON.stringify(displayedElements), [displayedElements]);

        useEffect(() => {
          presentationActiveRef.current = presentationActive;
        }, [presentationActive]);

        useEffect(() => {
          const updateHostContext = (context) => {
            if (context?.displayMode) setDisplayMode(context.displayMode);
            if (Array.isArray(context?.availableDisplayModes)) setAvailableDisplayModes(context.availableDisplayModes);
          };
          updateHostContext(app.getHostContext?.());
          app.onhostcontextchanged = updateHostContext;
          return () => { app.onhostcontextchanged = () => {}; };
        }, [app]);

        useEffect(() => {
          if (!presentationPlaying || !presentationSteps.length) return undefined;
          const timer = window.setTimeout(() => {
            if (presentationIndex >= presentationSteps.length - 1) setPresentationPlaying(false);
            else setPresentationIndex((index) => index + 1);
          }, Number(presentationStep?.durationMs) || 500);
          return () => window.clearTimeout(timer);
        }, [presentationIndex, presentationPlaying, presentationSteps]);

        useEffect(() => {
          const applyInput = (input, partial = false) => {
            const args = input?.arguments || input || {};
            const nextEngine = args.engine === 'mermaid' || (args.source && !args.scene && !args.elements) ? 'mermaid' : 'excalidraw';
            setEngine(nextEngine);
            if (!partial || args.presentation !== undefined) setPresentation(args.presentation || null);
            setStreaming(partial && nextEngine === 'excalidraw');
            if (!partial && ((nextEngine === 'excalidraw' && (args.elements !== undefined || args.scene !== undefined)) || (nextEngine === 'mermaid' && typeof args.source === 'string' && args.source.trim()))) {
              setPresentationIndex(0);
              setPresentationActive(true);
              setPresentationPlaying(true);
            }
            if (nextEngine === 'mermaid') {
              if (typeof args.source === 'string' && args.source.trim()) {
                apiRef.current = null;
                setApi(null);
                setElements([]);
                setSource(args.source.trim());
                setStatus(partial ? '正在绘制 Mermaid 图解...' : '图解已生成');
              }
            } else {
              const content = extractContent(args.elements !== undefined ? args.elements : args.scene, { partial });
              const converted = convertRawElements(content.elements, partial && !content.complete);
              if (converted.elements.length || (!partial && content.elements.length === 0)) {
                setElements(converted.elements);
                setSource('');
                if (content.appState) setAppState(content.appState);
                if (content.files) setFiles(content.files);
                setStatus(partial ? '正在绘制...' : '图解已加载，可直接编辑');
              }
              if (converted.camera && apiRef.current) applyCameraUpdate(apiRef.current, converted.camera);
            }
            if (args.title) setTitle(String(args.title));
            if (args.url) setDiagramUrl(String(args.url));
          };
          const applyResult = (result) => {
            // MCP Apps delivers the renderable data through ontoolinput. The
            // result is metadata only; parsing arbitrary result text here can
            // mistake the resource HTML or a human-readable note for Mermaid
            // source and overwrite an already-rendered canvas.
            // Some MCP host bridges serialize the field with Rust's
            // snake_case naming. Accept both spellings so the embedded app
            // can hydrate from the same typed result across hosts.
            const value = result?.structuredContent ?? result?.structured_content;
            if (value && typeof value === 'object') {
              // A few hosts expose only structured tool results to the app.
              // Hydrate only an explicitly typed Excalidraw payload so the
              // fallback remains safe and does not reinterpret arbitrary text.
              if ((value.engine === 'excalidraw' && (value.elements !== undefined || value.scene !== undefined))
                || (value.engine === 'mermaid' && value.source)) {
                applyInput(value, false);
              }
              if (value.presentation !== undefined) setPresentation(value.presentation || null);
              if (value.title) setTitle(String(value.title));
              if (value.url) setDiagramUrl(String(value.url));
              if (value.note) setStatus(String(value.note));
              const requestedUrl = String(value.url || value.openResource?.url || '').trim();
              const hostSupportsOpenLinks = typeof app.getHostCapabilities === 'function'
                && Boolean(app.getHostCapabilities()?.openLinks);
              if (value.openRequested === true
                && value.openAction === 'open_url_if_supported'
                && requestedUrl
                && hostSupportsOpenLinks
                && typeof app.openLink === 'function'
                && lastAutoOpenedUrlRef.current !== requestedUrl) {
                lastAutoOpenedUrlRef.current = requestedUrl;
                Promise.resolve(app.openLink({ url: requestedUrl })).then((openResult) => {
                  if (openResult?.isError) setStatus('无法打开 AnchorRead 页面');
                }).catch((openError) => {
                  setStatus('无法打开 AnchorRead 页面：' + (openError?.message || openError));
                });
              }
            }
            if (result?.isError) {
              const message = result?.content?.find((item) => item.type === 'text')?.text;
              if (message) setStatus(String(message));
            }
          };
          const applyError = (error) => setStatus(String(error?.message || error));
          const handlers = {
            partial: (input) => applyInput(input, true),
            input: (input) => applyInput(input, false),
            result: applyResult,
            error: applyError,
          };
          handlersRef.current = handlers;
          const pendingEvents = pendingEventsRef.current.splice(0);
          for (const event of pendingEvents) handlers[event.kind]?.(event.payload);
          return () => {
            if (handlersRef.current === handlers) handlersRef.current = {};
          };
        }, [app, handlersRef, pendingEventsRef]);

        useEffect(() => {
          if (engine !== 'mermaid' || !source) {
            setMermaidSvg('');
            cancelAnimationFrame(presentationAnimFrameRef.current);
            baseViewBoxRef.current = null;
            currentViewBoxRef.current = null;
            return undefined;
          }
          let disposed = false;
          (async () => {
            try {
              mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
              const rendered = await mermaid.render('anchorread-mermaid-' + Date.now(), source);
              if (!disposed) {
                setMermaidSvg(cleanMermaidSvg(rendered.svg));
                baseViewBoxRef.current = null;
                currentViewBoxRef.current = null;
              }
            } catch (error) {
              if (!disposed) {
                setMermaidSvg('');
                setStatus('Mermaid 渲染失败：' + (error?.message || error));
              }
            }
          })();
          return () => { disposed = true; };
        }, [engine, source]);

        useEffect(() => {
          if (engine !== 'excalidraw' || !streaming || !elements.length) {
            setPreviewSvg('');
            return undefined;
          }
          let disposed = false;
          (async () => {
            try {
              const svg = await exportToSvg({
                elements,
                appState: { viewBackgroundColor: 'transparent', exportBackground: false },
                files,
                exportPadding: 20,
                skipInliningFonts: true,
              });
              if (!disposed) setPreviewSvg(cleanMermaidSvg(svg.outerHTML));
            } catch {
              if (!disposed) setPreviewSvg('');
            }
          })();
          return () => { disposed = true; };
        }, [engine, elements, files, streaming]);

        const [lastAppliedElements, setLastAppliedElements] = useState('');
        useEffect(() => {
          if (!api || !elements.length || typeof api.updateScene !== 'function' || displayedElementsKey === lastAppliedElements) return;
          api.updateScene({ elements: displayedElements, appState, files });
          setLastAppliedElements(displayedElementsKey);
          if (!presentationActive && displayedElements.length && typeof api.scrollToContent === 'function') {
            window.requestAnimationFrame(() => {
              if (apiRef.current !== api) return;
              api.scrollToContent(displayedElements, {
                fitToContent: true,
                animate: false,
                duration: 0,
              });
            });
          }
        }, [api, appState, displayedElements, displayedElementsKey, elements, files, lastAppliedElements, presentationActive]);

        useEffect(() => {
          if (!presentationActive || engine !== 'excalidraw' || !api || !presentationStep) return undefined;
          const focusIds = new Set(presentationStep.focusElementIds || []);
          const focusElements = focusIds.size
            ? displayedElements.filter((element) => focusIds.has(element?.id) || (element?.containerId && focusIds.has(element.containerId)))
            : displayedElements;
          if (presentationStep.camera && typeof api.updateScene === 'function') {
            const currentState = typeof api.getAppState === 'function' ? api.getAppState() : appState;
            const target = resolveCameraTarget(presentationStep.camera, currentState);
            const from = {
              scrollX: Number(currentState?.scrollX) || 0,
              scrollY: Number(currentState?.scrollY) || 0,
              zoom: Number(currentState?.zoom?.value) || 1,
            };
            const duration = presentationTransitionDuration(presentationStep);
            const startedAt = performance.now();
            cancelAnimationFrame(presentationAnimFrameRef.current);
            const tick = (now) => {
              const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
              const eased = easeInOutQuad(progress);
              api.updateScene({ appState: {
                viewModeEnabled: true,
                scrollX: from.scrollX + (target.scrollX - from.scrollX) * eased,
                scrollY: from.scrollY + (target.scrollY - from.scrollY) * eased,
                zoom: { value: from.zoom + (target.zoom - from.zoom) * eased },
              } });
              if (progress < 1) presentationAnimFrameRef.current = requestAnimationFrame(tick);
            };
            presentationAnimFrameRef.current = requestAnimationFrame(tick);
          } else if (focusElements.length && typeof api.scrollToContent === 'function') {
            api.scrollToContent(focusElements, {
              fitToContent: true,
              animate: true,
              duration: Number(presentationStep.transitionMs) || 450,
            });
          }
          return () => cancelAnimationFrame(presentationAnimFrameRef.current);
        }, [api, appState, displayedElements, engine, presentationActive, presentationStep]);

        useEffect(() => {
          const host = mermaidHostRef.current;
          const svg = host?.querySelector('svg');
          if (engine !== 'mermaid' || !mermaidSvg || !svg) return undefined;
          if (!baseViewBoxRef.current) {
            baseViewBoxRef.current = parseSvgViewBox(svg);
            currentViewBoxRef.current = baseViewBoxRef.current;
            const base = baseViewBoxRef.current;
            svg.setAttribute('viewBox', base.x + ' ' + base.y + ' ' + base.width + ' ' + base.height);
          }
          const visualItems = [...svg.querySelectorAll('.node, .edgePath, .edgeLabel, .cluster, .actor, .messageText, .loopText')];
          const visibleIds = presentationActive && presentationStep ? presentationStep.visibleElementIds || [] : [];
          const syntheticIds = syntheticMermaidIds(visibleIds);
          const matchedVisible = syntheticIds ? [] : matchingVisualItems(visualItems, visibleIds);
          const stepCount = Math.max(1, presentationSteps.length);
          const visibleCount = presentationActive && presentationStep
            ? Math.max(1, Math.ceil(visualItems.length * Math.max(1, presentationIndex + 1) / stepCount))
            : visualItems.length;
          visualItems.forEach((item, index) => {
            const visible = presentationActive && presentationStep && visibleIds.length && !syntheticIds && matchedVisible.length
              ? matchedVisible.includes(item)
              : index < visibleCount;
            item.style.opacity = visible ? '' : '0';
            item.style.pointerEvents = visible ? '' : 'none';
            item.style.filter = '';
          });
          if (presentationActive && presentationStep?.highlightElementIds?.length) {
            matchingVisualItems(visualItems, presentationStep.highlightElementIds)
              .forEach((item) => { item.style.filter = 'drop-shadow(0 0 4px rgba(225, 29, 72, 0.85))'; });
          }
          const focusViewBox = presentationActive && presentationStep?.focusElementIds?.length
            ? visualItemsBounds(matchingVisualItems(visualItems, presentationStep.focusElementIds))
            : null;
          const base = baseViewBoxRef.current;
          const target = presentationActive && presentationStep?.camera
            ? resolveMermaidViewBox(presentationStep.camera, base)
            : focusViewBox || base;
          if (!target || !base) return undefined;
          const from = currentViewBoxRef.current || parseSvgViewBox(svg);
          const duration = presentationTransitionDuration(presentationStep);
          const startedAt = performance.now();
          cancelAnimationFrame(presentationAnimFrameRef.current);
          const tick = (now) => {
            const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
            const eased = easeInOutQuad(progress);
            const next = {
              x: from.x + (target.x - from.x) * eased,
              y: from.y + (target.y - from.y) * eased,
              width: from.width + (target.width - from.width) * eased,
              height: from.height + (target.height - from.height) * eased,
            };
            svg.setAttribute('viewBox', next.x + ' ' + next.y + ' ' + next.width + ' ' + next.height);
            currentViewBoxRef.current = next;
            if (progress < 1) presentationAnimFrameRef.current = requestAnimationFrame(tick);
          };
          presentationAnimFrameRef.current = requestAnimationFrame(tick);
          return () => cancelAnimationFrame(presentationAnimFrameRef.current);
        }, [engine, mermaidSvg, presentationActive, presentationIndex, presentationStep, presentationSteps]);

        const hostSupportsOpenLinks = typeof app.getHostCapabilities === 'function'
          && Boolean(app.getHostCapabilities()?.openLinks);
        const openAnchorRead = () => {
          if (!diagramUrl || !hostSupportsOpenLinks || typeof app.openLink !== 'function') return;
          Promise.resolve(app.openLink({ url: diagramUrl })).then((result) => {
            if (result?.isError) setStatus('无法打开 AnchorRead 页面');
          }).catch((error) => {
            setStatus('无法打开 AnchorRead 页面：' + (error?.message || error));
          });
        };

        const canFullscreen = availableDisplayModes.includes('fullscreen') || displayMode === 'fullscreen';
        const toggleFullscreen = () => {
          if (!canFullscreen || typeof app.requestDisplayMode !== 'function') return;
          const mode = displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
          Promise.resolve(app.requestDisplayMode({ mode })).then((result) => {
            if (result?.mode) setDisplayMode(result.mode);
          }).catch((error) => {
            setStatus('无法切换全屏：' + (error?.message || error));
          });
        };

        const toolbarLabel = status || title;
        return React.createElement('div', { className: 'app-shell app-display-' + displayMode },
          React.createElement('div', { className: 'app-toolbar' },
            React.createElement('div', { className: 'app-title', title: toolbarLabel }, toolbarLabel),
            React.createElement('div', { className: 'app-toolbar-actions' },
              hostSupportsOpenLinks && diagramUrl
                ? React.createElement('button', { className: 'app-button', type: 'button', onClick: openAnchorRead }, '在 AnchorRead 中打开')
                : null,
              engine === 'excalidraw' && !streaming && elements.length
                ? React.createElement('button', {
                  className: 'app-icon-button',
                  type: 'button',
                  'aria-label': editing ? '退出编辑' : '编辑图解',
                  title: editing ? '退出编辑' : '编辑图解',
                  onClick: () => setEditing((value) => !value),
                }, React.createElement(editing ? Eye : Pencil, { size: 15, strokeWidth: 2.1, 'aria-hidden': true }))
                : null,
              canFullscreen
                ? React.createElement('button', {
                  className: 'app-icon-button',
                  type: 'button',
                  'aria-label': displayMode === 'fullscreen' ? '退出全屏' : '全屏查看',
                  title: displayMode === 'fullscreen' ? '退出全屏' : '全屏查看',
                  onClick: toggleFullscreen,
                }, React.createElement(displayMode === 'fullscreen' ? Minimize2 : Maximize2, { size: 15, strokeWidth: 2.1, 'aria-hidden': true }))
                : null,
            ),
          ),
          React.createElement('div', { className: 'app-canvas' + (editing ? ' app-editing' : ' app-focus-mode') },
            engine === 'mermaid' && mermaidSvg
              ? React.createElement('div', { ref: mermaidHostRef, className: 'app-mermaid', dangerouslySetInnerHTML: { __html: mermaidSvg } })
              : engine === 'mermaid' && source
                ? React.createElement('pre', { className: 'app-source' }, source)
                : engine === 'excalidraw' && streaming && previewSvg
                  ? React.createElement('div', { className: 'app-preview', dangerouslySetInnerHTML: { __html: previewSvg } })
                : elements.length
              ? React.createElement(Excalidraw, {
                excalidrawAPI: (nextApi) => {
                  apiRef.current = nextApi;
                  setApi(nextApi);
                },
                viewModeEnabled: !editing,
                UIOptions: {
                  canvasActions: {
                    changeViewBackgroundColor: false,
                    clearCanvas: false,
                    export: false,
                    loadScene: false,
                    saveToActiveFile: false,
                    toggleTheme: false,
                    saveAsImage: false,
                  },
                  tools: { image: false },
                  welcomeScreen: false,
                },
                initialData: { elements, appState, files, scrollToContent: true },
                onChange: (nextElements) => {
                  if (presentationActiveRef.current) return;
                  setStreaming(false);
                  setElements(nextElements);
                  setLastAppliedElements(JSON.stringify(nextElements));
                },
              })
              : React.createElement('div', { className: 'app-empty' }, '等待图解输入'),
          ),
          presentationSteps.length
            ? React.createElement('div', { className: 'app-playback ' + (playbackExpanded ? 'app-playback-expanded' : 'app-playback-collapsed'), role: 'group', 'aria-label': '图解播放' },
              React.createElement('button', { type: 'button', 'aria-label': presentationPlaying ? '暂停' : '播放', title: presentationPlaying ? '暂停' : '播放', onClick: () => { setPresentationActive(true); setPresentationPlaying((playing) => !playing); } }, React.createElement(presentationPlaying ? Pause : Play, { size: 16, strokeWidth: 2.2, 'aria-hidden': true })),
              React.createElement('button', { className: 'app-playback-secondary', type: 'button', disabled: presentationIndex <= 0, 'aria-label': '上一步', title: '上一步', onClick: () => { setPresentationActive(true); setPresentationPlaying(false); setPresentationIndex((index) => Math.max(0, index - 1)); } }, React.createElement(ChevronLeft, { size: 16, strokeWidth: 2.2, 'aria-hidden': true })),
              React.createElement('select', { className: 'app-playback-secondary app-playback-select', value: presentationIndex, 'aria-label': '选择演示阶段', onChange: (event) => { setPresentationActive(true); setPresentationPlaying(false); setPresentationIndex(Number(event.target.value)); } }, presentationSteps.map((step, index) => React.createElement('option', { key: step.id || index, value: index }, step.title || '第 ' + (index + 1) + ' 步'))),
              React.createElement('span', { 'aria-live': 'polite' }, (presentationIndex + 1) + '/' + presentationSteps.length),
              React.createElement('button', { className: 'app-playback-secondary', type: 'button', disabled: presentationIndex >= presentationSteps.length - 1, 'aria-label': '下一步', title: '下一步', onClick: () => { setPresentationActive(true); setPresentationPlaying(false); setPresentationIndex((index) => Math.min(presentationSteps.length - 1, index + 1)); } }, React.createElement(ChevronRight, { size: 16, strokeWidth: 2.2, 'aria-hidden': true })),
              presentationActive && React.createElement('button', { className: 'app-playback-secondary', type: 'button', 'aria-label': '停止', title: '停止', onClick: () => { setPresentationActive(false); setPresentationPlaying(false); setPresentationIndex(0); } }, React.createElement(Square, { size: 15, strokeWidth: 2.2, 'aria-hidden': true })),
              React.createElement('button', { className: 'app-playback-expand', type: 'button', 'aria-expanded': playbackExpanded, 'aria-label': playbackExpanded ? '收起播放控件' : '展开播放控件', title: playbackExpanded ? '收起播放控件' : '展开播放控件', onClick: () => setPlaybackExpanded((expanded) => !expanded) }, React.createElement(playbackExpanded ? ChevronDown : ChevronUp, { size: 16, strokeWidth: 2.2, 'aria-hidden': true })),
            )
            : null,
        );
      }

      function AnchorReadDiagramApp() {
        const handlersRef = useRef({});
        const pendingEventsRef = useRef([]);
        const dispatchEvent = (kind, payload) => {
          const handler = handlersRef.current[kind];
          if (handler) handler(payload);
          else pendingEventsRef.current.push({ kind, payload });
        };
        const { app, error } = useApp({
          appInfo: { name: 'AnchorRead Excalidraw', version: '1.0.0' },
          capabilities: {},
          // Register one-shot MCP Apps notifications before connect(). The
          // host may deliver tool input/result during the handshake.
          onAppCreated: (createdApp) => {
            createdApp.ontoolinputpartial = (input) => dispatchEvent('partial', input);
            createdApp.ontoolinput = (input) => dispatchEvent('input', input);
            createdApp.ontoolresult = (result) => dispatchEvent('result', result);
            createdApp.onerror = (appError) => dispatchEvent('error', appError);
          },
        });
        if (error) return React.createElement('div', { className: 'app-empty' }, 'MCP App 连接失败：' + (error.message || error));
        if (!app) return React.createElement('div', { className: 'app-empty' }, '正在连接图解画布...');
        return React.createElement(AnchorReadDiagramAppCore, { app, handlersRef, pendingEventsRef });
      }

      createRoot(document.getElementById('root')).render(React.createElement(AnchorReadDiagramApp));
    </script>
  </body>
</html>`,
    _meta: {
      ui: {
        csp: APP_CSP,
        prefersBorder: true,
      },
    },
  };
}

export function diagramMcpAppResourceListing() {
  return {
    uri: DIAGRAM_MCP_APP_RESOURCE_URI,
    name: 'anchorread-diagram-app',
    title: 'AnchorRead Excalidraw 图解应用',
    description: '在支持 MCP Apps 的客户端内渲染并编辑 AnchorRead 图解。',
    mimeType: DIAGRAM_MCP_APP_MIME_TYPE,
    _meta: { ui: { csp: APP_CSP, prefersBorder: true } },
  };
}
