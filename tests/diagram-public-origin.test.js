import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagramWorkspaceUrl,
  createMcpToolResult,
} from '../lib/diagram-mcp-links.js';
import {
  DEFAULT_ANCHORREAD_PUBLIC_ORIGIN,
  isInternalBrowserHostname,
  resolveAnchorReadPublicOrigin,
} from '../lib/diagram-public-origin.js';
import { getDiagramMcpOAuthResourceMetadataUrl } from '../lib/diagram-mcp-authorization.js';

const canonicalWorkspace = `${DEFAULT_ANCHORREAD_PUBLIC_ORIGIN}/diagrams`;

test('production workspace URLs reject wildcard, loopback, and private listener origins', () => {
  for (const baseUrl of [
    'https://0.0.0.0:3000/mcp',
    'http://[::]:3000/mcp',
    'http://localhost:3000/mcp',
    'http://127.0.0.1:3000/mcp',
    'http://172.20.0.2:3000/mcp',
    'http://anchorread:3000/mcp',
  ]) {
    assert.equal(buildDiagramWorkspaceUrl({ baseUrl, publicUrl: '', production: true }), canonicalWorkspace);
  }
  assert.equal(isInternalBrowserHostname('0.0.0.0'), true);
  assert.equal(isInternalBrowserHostname('[::]'), true);
  assert.equal(isInternalBrowserHostname('localhost'), true);
});

test('development keeps an actual localhost origin available', () => {
  assert.equal(
    buildDiagramWorkspaceUrl({ baseUrl: 'http://localhost:3000/mcp', publicUrl: '', production: false }),
    'http://localhost:3000/diagrams',
  );
});

test('proxy headers and the configured public origin override the internal request URL', () => {
  const proxied = new Request('https://0.0.0.0:3000/mcp', {
    headers: {
      'x-forwarded-host': 'anchorread.flowguide.cc',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(
    buildDiagramWorkspaceUrl({ baseUrl: proxied, publicUrl: '', production: true }),
    canonicalWorkspace,
  );
  assert.equal(
    resolveAnchorReadPublicOrigin({
      baseUrl: new Request('http://internal-service:3000/mcp'),
      publicUrl: DEFAULT_ANCHORREAD_PUBLIC_ORIGIN,
      production: true,
    }),
    DEFAULT_ANCHORREAD_PUBLIC_ORIGIN,
  );
});

test('formal public domains remain unchanged across MCP and OAuth URL builders', () => {
  const request = new Request('http://0.0.0.0:3000/mcp', {
    headers: {
      'x-forwarded-host': 'anchorread.flowguide.cc',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(
    getDiagramMcpOAuthResourceMetadataUrl(request),
    `${DEFAULT_ANCHORREAD_PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp`,
  );
});

test('resource links sanitize an unsafe explicit workspace URL and preserve its query', () => {
  const result = createMcpToolResult({
    openResource: {
      kind: 'workspace',
      url: 'https://0.0.0.0:3000/diagrams?diagramWake=request-1',
    },
  });
  assert.equal(result.content[1].uri, `${canonicalWorkspace}?diagramWake=request-1`);
});
