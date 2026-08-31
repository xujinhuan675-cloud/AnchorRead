import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.match(resource.text, /exportToSvg/);
  assert.match(resource.text, /mermaid@11\.16\.1/);
  assert.match(resource.text, /useApp\(/);
  assert.match(resource.text, /ontoolinputpartial/);
  assert.match(resource.text, /cameraUpdate/);
  assert.match(resource.text, /excludeIncompleteLastItem/);
  assert.match(resource.text, /app-playback/);
  assert.match(resource.text, /defaultMermaidPresentation/);
  assert.match(resource.text, /'aria-label': presentationPlaying \? '暂停' : '播放'/);
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
