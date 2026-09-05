import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  DIAGRAM_MCP_APP_MIME_TYPE,
  DIAGRAM_MCP_APP_RESOURCE_URI,
  diagramMcpAppResourceListing,
  readDiagramMcpAppResource,
} from '../lib/diagram-mcp-app-resource.js';

test('MCP App resource exposes a pinned AnchorRead Excalidraw client', () => {
  const resource = readDiagramMcpAppResource();
  assert.equal(resource.uri, DIAGRAM_MCP_APP_RESOURCE_URI);
  assert.equal(resource.mimeType, DIAGRAM_MCP_APP_MIME_TYPE);
  assert.equal(resource._meta.ui.prefersBorder, true);
  assert.deepEqual(resource._meta.ui.csp.resourceDomains, ['https://esm.sh']);
  assert.match(resource.text, /@modelcontextprotocol\/ext-apps@0\.4\.0\/react/);
  assert.match(resource.text, /@excalidraw\/excalidraw@0\.18\.0/);
  assert.match(resource.text, /@excalidraw\/excalidraw@0\.18\.0\/dist\/prod\/index\.css/);
  assert.match(resource.text, /lucide-react@1\.31\.0/);
  assert.match(resource.text, /exportToSvg/);
  assert.match(resource.text, /mermaid@11\.16\.1/);
  assert.match(resource.text, /useApp\(/);
  assert.match(resource.text, /onAppCreated/);
  assert.match(resource.text, /pendingEventsRef/);
  assert.match(resource.text, /createdApp\.ontoolinputpartial/);
  assert.match(resource.text, /ontoolinputpartial/);
  assert.match(resource.text, /cameraUpdate/);
  assert.match(resource.text, /excludeIncompleteLastItem/);
  assert.match(resource.text, /app-playback/);
  assert.match(resource.text, /app-playback-collapsed/);
  assert.match(resource.text, /app-playback-secondary/);
  assert.match(resource.text, /playbackExpanded/);
  assert.match(resource.text, /aria-label': playbackExpanded \? '收起播放控件' : '展开播放控件'/);
  assert.match(resource.text, /ChevronDown/);
  assert.match(resource.text, /ChevronUp/);
  assert.match(resource.text, /app-toolbar-actions/);
  assert.match(resource.text, /app-icon-button/);
  assert.doesNotMatch(resource.text, /className: 'app-status'/);
  assert.match(resource.text, /const toolbarLabel = status \|\| title/);
  assert.match(resource.text, /aria-label': editing \? '退出编辑' : '编辑图解'/);
  assert.match(resource.text, /engine === 'excalidraw' && !streaming && elements\.length/);
  assert.match(resource.text, /getHostCapabilities\(\)/);
  assert.match(resource.text, /hostSupportsOpenLinks/);
  assert.match(resource.text, /hostSupportsOpenLinks && diagramUrl/);
  assert.match(resource.text, /result\?\.isError/);
  assert.doesNotMatch(resource.text, /window\.open\(diagramUrl/);
  assert.match(resource.text, /viewModeEnabled: !editing/);
  assert.match(resource.text, /UIOptions: \{/);
  assert.match(resource.text, /welcomeScreen: false/);
  assert.match(resource.text, /app-focus-mode \.excalidraw \.App-menu_top/);
  assert.match(resource.text, /app-focus-mode \.excalidraw \.App-menu_bottom/);
  assert.match(resource.text, /main-menu-trigger/);
  assert.match(resource.text, /app-focus-mode \.excalidraw \.App-top-bar/);
  assert.match(resource.text, /app-focus-mode \.excalidraw \.App-bottom-bar/);
  assert.match(resource.text, /app-canvas' \+ \(editing \? ' app-editing' : ' app-focus-mode'\)/);
  assert.match(resource.text, /\.app-canvas \{ position: relative; height: clamp\(360px, 55vh, 620px\)/);
  assert.match(resource.text, /\.app-canvas > \.excalidraw \{ width: 100%; height: 100%; \}/);
  assert.match(resource.text, /api\.scrollToContent\(displayedElements/);
  assert.match(resource.text, /defaultMermaidPresentation/);
  assert.match(resource.text, /element\.type === 'text' && element\.containerId/);
  assert.match(resource.text, /'aria-label': presentationPlaying \? '暂停' : '播放'/);
  assert.match(resource.text, /presentationPlaying \? Pause : Play/);
  assert.match(resource.text, /normalizePresentation\(/);
  assert.match(resource.text, /presentationStep\.focusElementIds/);
  assert.match(resource.text, /presentationStep\.camera/);
  assert.match(resource.text, /presentationStep\.highlightElementIds/);
  assert.match(resource.text, /app-playback-select/);
  assert.match(resource.text, /presentationIndex \+ 1\) \+ '\/' \+ presentationSteps\.length/);
  assert.match(resource.text, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(resource.text, /app-playback-title/);
  assert.doesNotMatch(resource.text, /presentationStepLabel/);
  assert.match(resource.text, /app-display-fullscreen/);
  assert.match(resource.text, /app\.requestDisplayMode\(\{ mode \}\)/);
  assert.match(resource.text, /app\.onhostcontextchanged = updateHostContext/);
  assert.match(resource.text, /value\.openRequested === true/);
  assert.match(resource.text, /app\.openLink\(\{ url: requestedUrl \}\)/);
  assert.match(resource.text, /presentationTransitionDuration\(presentationStep\)/);
  assert.match(resource.text, /React\.createElement\(ChevronLeft/);
  assert.match(resource.text, /React\.createElement\(ChevronRight/);
  assert.match(resource.text, /React\.createElement\(Square/);
  assert.doesNotMatch(resource.text, /presentationPlaying \? '\|\|' : '>'/);
  assert.match(resource.text, /在 AnchorRead 中打开/);
  assert.match(resource.text, /\.replace\(\/<script\[\\s\\S\]\*\?<\\\/script>\/gi/);
  assert.equal(resource.text.split('</script>').length - 1, 1);
  assert.doesNotMatch(resource.text, /<script\[sS\]\*\?<\/script>/);
  assert.doesNotMatch(resource.text, /\.replace\(\/s\+on\[a-z-\]/);
  assert.match(resource.text, /MCP Apps delivers the renderable data through ontoolinput/);
  assert.match(resource.text, /result\?\.structuredContent \?\? result\?\.structured_content/);
  assert.match(resource.text, /value\.engine === 'excalidraw'/);
  assert.match(resource.text, /applyInput\(value, false\)/);
  assert.doesNotMatch(resource.text, /const value = resultValue\(result\)/);
  assert.doesNotMatch(resource.text, /ANCHORREAD_MCP|Bearer\s+/i);
});

test('MCP App embedded module remains syntactically valid', () => {
  const resource = readDiagramMcpAppResource();
  const moduleMatch = resource.text.match(/<script type="module">([\s\S]*?)<\/script>/u);
  assert.ok(moduleMatch, 'expected one embedded module script');
  const scriptWithoutImports = moduleMatch[1]
    .replace(/^\s*import\s+.*?;\s*$/gmu, '')
    .replace(/^\s*createRoot\(document\.getElementById\('root'\)\).*?;\s*$/gmu, '');
  assert.doesNotThrow(() => new vm.Script(scriptWithoutImports, { filename: 'anchorread-diagram-mcp-app.js' }));
});

test('MCP App resource listing carries the standard app MIME type', () => {
  const listing = diagramMcpAppResourceListing();
  assert.deepEqual(listing, {
    uri: DIAGRAM_MCP_APP_RESOURCE_URI,
    name: 'anchorread-diagram-app',
    title: 'AnchorRead Excalidraw 图解应用',
    description: '在支持 MCP Apps 的客户端内渲染并编辑 AnchorRead 图解。',
    mimeType: DIAGRAM_MCP_APP_MIME_TYPE,
    _meta: { ui: { csp: { resourceDomains: ['https://esm.sh'], connectDomains: ['https://esm.sh'] }, prefersBorder: true } },
  });
});
