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
  assert.match(resource.text, /@modelcontextprotocol\/ext-apps@1\.7\.5/);
  assert.match(resource.text, /@excalidraw\/excalidraw@0\.18\.0/);
  assert.match(resource.text, /new App\(/);
  assert.match(resource.text, /app\.connect\(\)/);
  assert.match(resource.text, /在 AnchorRead 中打开/);
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
