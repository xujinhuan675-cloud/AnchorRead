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
      .app-shell { min-height: 420px; display: flex; flex-direction: column; }
      .app-toolbar { display: flex; align-items: center; gap: .5rem; padding: .65rem .8rem; border-bottom: 1px solid #e7e5e4; }
      .app-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9rem; font-weight: 650; }
      .app-button { border: 1px solid #d6d3d1; border-radius: .4rem; background: #fff; color: #292524; padding: .42rem .65rem; font-size: .78rem; cursor: pointer; }
      .app-button:hover { background: #f5f5f4; }
      .app-button:disabled { cursor: default; opacity: .5; }
      .app-status { padding: .55rem .8rem; border-bottom: 1px solid #e7e5e4; color: #78716c; font-size: .75rem; }
      .app-canvas { position: relative; min-height: 360px; flex: 1; }
      .app-empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 2rem; color: #78716c; font-size: .85rem; text-align: center; }
      .app-source { margin: 0; padding: 1rem; overflow: auto; color: #44403c; background: #fafaf9; font: .78rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
      .app-mermaid { min-height: 360px; overflow: auto; display: grid; place-items: center; padding: 1rem; background: #fff; }
      .app-mermaid svg { max-width: 100%; height: auto; }
      .app-preview { min-height: 360px; overflow: hidden; display: grid; place-items: center; padding: 1rem; background: #fff; }
      .app-preview svg { width: 100%; height: 100%; max-width: 100%; }
      .app-playback { position: absolute; right: .8rem; bottom: .8rem; z-index: 5; display: flex; align-items: center; gap: .2rem; padding: .2rem; border: 1px solid #d6d3d1; border-radius: .4rem; background: rgba(255,255,255,.94); box-shadow: 0 2px 8px rgba(28,25,23,.12); }
      .app-playback button { width: 2rem; height: 2rem; border: 0; border-radius: .25rem; background: transparent; color: #44403c; cursor: pointer; }
      .app-playback button:hover { background: #f5f5f4; }
      .app-playback button:focus-visible { outline: 2px solid #a8a29e; outline-offset: 1px; }
      .app-playback span { min-width: 2.5rem; text-align: center; color: #57534e; font: .75rem ui-monospace, SFMono-Regular, Menlo, monospace; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      import React, { useEffect, useMemo, useRef, useState } from 'https://esm.sh/react@19.2.0';
      import { createRoot } from 'https://esm.sh/react-dom@19.2.0/client';
      import { useApp } from 'https://esm.sh/@modelcontextprotocol/ext-apps@0.4.0/react?deps=react@19.2.0,react-dom@19.2.0';
      import { Excalidraw, exportToSvg, convertToExcalidrawElements, FONT_FAMILY } from 'https://esm.sh/@excalidraw/excalidraw@0.18.0?deps=react@19.2.0,react-dom@19.2.0';
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
        const ids = (Array.isArray(elements) ? elements : []).map((element) => element?.id).filter(Boolean);
        return ids.map((_id, index) => ({ visibleElementIds: ids.slice(0, index + 1) }));
      }

      function defaultMermaidPresentation(source) {
        const lines = String(source || '').split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith('%%'));
        return lines.map((_line, index) => ({ visibleElementIds: lines.slice(0, index + 1).map((_item, itemIndex) => 'mermaid-' + (itemIndex + 1)) }));
      }

      function visibleElements(elements, step) {
        if (!step?.visibleElementIds?.length) return elements;
        const visible = new Set(step.visibleElementIds);
        return (Array.isArray(elements) ? elements : []).filter((element) => visible.has(element?.id) || (element?.containerId && visible.has(element.containerId)));
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

      function AnchorReadDiagramAppCore({ app }) {
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
        const [api, setApi] = useState(null);
        const [status, setStatus] = useState('等待图解输入');
        const apiRef = useRef(null);
        const presentationActiveRef = useRef(false);

        const presentationSteps = useMemo(() => (
          engine === 'mermaid' ? defaultMermaidPresentation(source) : defaultElementPresentation(elements)
        ), [engine, elements, source]);
        const presentationStep = presentationSteps[presentationIndex] || null;
        const displayedElements = presentationActive && engine === 'excalidraw'
          ? visibleElements(elements, presentationStep)
          : elements;
        const displayedElementsKey = useMemo(() => JSON.stringify(displayedElements), [displayedElements]);

        useEffect(() => {
          presentationActiveRef.current = presentationActive;
        }, [presentationActive]);

        useEffect(() => {
          if (!presentationPlaying || !presentationSteps.length) return undefined;
          const timer = window.setTimeout(() => {
            if (presentationIndex >= presentationSteps.length - 1) setPresentationPlaying(false);
            else setPresentationIndex((index) => index + 1);
          }, 500);
          return () => window.clearTimeout(timer);
        }, [presentationIndex, presentationPlaying, presentationSteps]);

        useEffect(() => {
          const applyInput = (input, partial = false) => {
            const args = input?.arguments || input || {};
            const nextEngine = args.engine === 'mermaid' || (args.source && !args.scene && !args.elements) ? 'mermaid' : 'excalidraw';
            setEngine(nextEngine);
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
          app.ontoolinputpartial = (input) => applyInput(input, true);
          app.ontoolinput = (input) => applyInput(input, false);
          app.ontoolresult = (result) => {
            // MCP Apps delivers the renderable data through ontoolinput. The
            // result is metadata only; parsing arbitrary result text here can
            // mistake the resource HTML or a human-readable note for Mermaid
            // source and overwrite an already-rendered canvas.
            const value = result?.structuredContent;
            if (value && typeof value === 'object') {
              if (value.title) setTitle(String(value.title));
              if (value.url) setDiagramUrl(String(value.url));
              if (value.note) setStatus(String(value.note));
            }
            if (result?.isError) {
              const message = result?.content?.find((item) => item.type === 'text')?.text;
              if (message) setStatus(String(message));
            }
          };
          app.onerror = (error) => setStatus(String(error?.message || error));
        }, [app]);

        useEffect(() => {
          if (engine !== 'mermaid' || !source) {
            setMermaidSvg('');
            return undefined;
          }
          let disposed = false;
          (async () => {
            try {
              mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
              const rendered = await mermaid.render('anchorread-mermaid-' + Date.now(), source);
              if (!disposed) setMermaidSvg(cleanMermaidSvg(rendered.svg));
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
        }, [api, appState, displayedElements, displayedElementsKey, elements, files, lastAppliedElements]);

        useEffect(() => {
          if (engine !== 'mermaid' || !mermaidSvg) return;
          const visualItems = [...document.querySelectorAll('.app-mermaid .node, .app-mermaid .edgePath, .app-mermaid .edgeLabel, .app-mermaid .cluster, .app-mermaid .actor, .app-mermaid .messageText, .app-mermaid .loopText')];
          const stepCount = Math.max(1, presentationSteps.length);
          const visibleCount = presentationActive && presentationStep
            ? Math.max(1, Math.ceil(visualItems.length * Math.max(1, presentationIndex + 1) / stepCount))
            : visualItems.length;
          visualItems.forEach((item, index) => { item.style.opacity = index < visibleCount ? '' : '0'; item.style.pointerEvents = index < visibleCount ? '' : 'none'; });
        }, [engine, mermaidSvg, presentationActive, presentationIndex, presentationStep, presentationSteps]);

        const openAnchorRead = () => {
          if (!diagramUrl) return;
          if (typeof app.openLink === 'function') app.openLink({ url: diagramUrl });
          else window.open(diagramUrl, '_blank', 'noopener,noreferrer');
        };

        return React.createElement('div', { className: 'app-shell' },
          React.createElement('div', { className: 'app-toolbar' },
            React.createElement('div', { className: 'app-title', title }, title),
            React.createElement('button', { className: 'app-button', type: 'button', disabled: !diagramUrl, onClick: openAnchorRead }, '在 AnchorRead 中打开'),
          ),
          React.createElement('div', { className: 'app-status' }, status),
          React.createElement('div', { className: 'app-canvas' },
            engine === 'mermaid' && mermaidSvg
              ? React.createElement('div', { className: 'app-mermaid', dangerouslySetInnerHTML: { __html: mermaidSvg } })
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
            ? React.createElement('div', { className: 'app-playback', role: 'group', 'aria-label': '图解播放' },
              React.createElement('button', { type: 'button', 'aria-label': presentationPlaying ? '暂停' : '播放', title: presentationPlaying ? '暂停' : '播放', onClick: () => { setPresentationActive(true); setPresentationPlaying((playing) => !playing); } }, presentationPlaying ? '||' : '>'),
              React.createElement('button', { type: 'button', 'aria-label': '上一步', title: '上一步', onClick: () => { setPresentationActive(true); setPresentationPlaying(false); setPresentationIndex((index) => Math.max(0, index - 1)); } }, '<'),
              React.createElement('span', { 'aria-live': 'polite' }, (presentationIndex + 1) + '/' + presentationSteps.length),
              React.createElement('button', { type: 'button', 'aria-label': '下一步', title: '下一步', onClick: () => { setPresentationActive(true); setPresentationPlaying(false); setPresentationIndex((index) => Math.min(presentationSteps.length - 1, index + 1)); } }, '>'),
              presentationActive && React.createElement('button', { type: 'button', 'aria-label': '停止', title: '停止', onClick: () => { setPresentationActive(false); setPresentationPlaying(false); setPresentationIndex(0); } }, '[]'),
            )
            : null,
        );
      }

      function AnchorReadDiagramApp() {
        const { app, error } = useApp({
          appInfo: { name: 'AnchorRead Excalidraw', version: '1.0.0' },
          capabilities: {},
        });
        if (error) return React.createElement('div', { className: 'app-empty' }, 'MCP App 连接失败：' + (error.message || error));
        if (!app) return React.createElement('div', { className: 'app-empty' }, '正在连接图解画布...');
        return React.createElement(AnchorReadDiagramAppCore, { app });
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
