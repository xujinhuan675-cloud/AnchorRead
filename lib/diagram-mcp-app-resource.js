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
    text: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AnchorRead 图解</title>
    <link rel="stylesheet" href="https://esm.sh/@excalidraw/excalidraw@0.18.0/index.css">
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
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@19.2.0';
      import { createRoot } from 'https://esm.sh/react-dom@19.2.0/client';
      import { App } from 'https://esm.sh/@modelcontextprotocol/ext-apps@1.7.5';
      import { Excalidraw, convertToExcalidrawElements } from 'https://esm.sh/@excalidraw/excalidraw@0.18.0?deps=react@19.2.0,react-dom@19.2.0';

      function parseJson(value) {
        if (typeof value !== 'string') return value;
        try { return JSON.parse(value); } catch { return null; }
      }

      function sceneElements(value) {
        const parsed = parseJson(value);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.elements)) return parsed.elements;
        return [];
      }

      function resultValue(result) {
        if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
        const text = result?.content?.find((item) => item.type === 'text')?.text;
        return parseJson(text) || {};
      }

      function normalizeElements(elements) {
        if (!Array.isArray(elements) || elements.length === 0) return [];
        if (elements.every((element) => Number.isFinite(element?.version))) return elements;
        try { return convertToExcalidrawElements(elements, { regenerateIds: false }); } catch { return []; }
      }

      function AnchorReadDiagramApp() {
        const app = useMemo(() => new App({ name: 'AnchorRead Excalidraw', version: '1.0.0' }), []);
        const [elements, setElements] = useState([]);
        const [title, setTitle] = useState('AnchorRead 图解');
        const [diagramUrl, setDiagramUrl] = useState('');
        const [source, setSource] = useState('');
        const [api, setApi] = useState(null);
        const [status, setStatus] = useState('等待图解输入');

        useEffect(() => {
          const applyInput = (input) => {
            const args = input?.arguments || input || {};
            const next = normalizeElements(sceneElements(args.scene || args.elements));
            if (next.length) {
              setElements(next);
              setSource('');
              setStatus('图解已加载，可直接编辑');
            }
            if (args.title) setTitle(String(args.title));
            if (args.url) setDiagramUrl(String(args.url));
            if (args.source) setSource(String(args.source));
          };
          app.ontoolinputpartial = applyInput;
          app.ontoolinput = applyInput;
          app.ontoolresult = (result) => {
            const value = resultValue(result);
            const next = normalizeElements(sceneElements(value.scene || value.elements));
            if (next.length) {
              setElements(next);
              setSource('');
              setStatus('图解已生成，可直接编辑');
            }
            if (value.title) setTitle(String(value.title));
            if (value.url) setDiagramUrl(String(value.url));
            if (value.source) setSource(String(value.source));
          };
          app.onerror = (error) => setStatus(String(error?.message || error));
          Promise.resolve(app.connect()).catch((error) => setStatus(String(error?.message || error)));
        }, [app]);

        const appliedElements = useMemo(() => JSON.stringify(elements), [elements]);
        const [lastAppliedElements, setLastAppliedElements] = useState('');
        useEffect(() => {
          if (!api || !elements.length || typeof api.updateScene !== 'function' || appliedElements === lastAppliedElements) return;
          api.updateScene({ elements });
          setLastAppliedElements(appliedElements);
        }, [api, appliedElements, elements, lastAppliedElements]);

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
            elements.length
              ? React.createElement(Excalidraw, {
                excalidrawAPI: setApi,
                initialData: { elements, scrollToContent: true },
                onChange: (nextElements) => {
                  setElements(nextElements);
                  setLastAppliedElements(JSON.stringify(nextElements));
                },
              })
              : source
                ? React.createElement('pre', { className: 'app-source' }, source)
                : React.createElement('div', { className: 'app-empty' }, '调用 create_diagram 后，图解会直接显示在这里。'),
          ),
        );
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
