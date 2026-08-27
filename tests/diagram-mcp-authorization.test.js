import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDiagramMcpAuthorizationInfo,
  getDiagramMcpAuthorizationInfoUrl,
  getDiagramMcpAuthorizationUrl,
  getDiagramMcpDiagramsUrl,
  getDiagramMcpOAuthAuthorizationUrl,
  getDiagramMcpOAuthRegisterUrl,
  getDiagramMcpOAuthResourceMetadataUrl,
  getDiagramMcpOAuthServerMetadataUrl,
  getDiagramMcpOAuthTokenUrl,
  getDiagramMcpResourceUrl,
} from '../lib/diagram-mcp-authorization.js';

test('authorization metadata stays same-origin and contains no secret material', () => {
  const info = getDiagramMcpAuthorizationInfo('https://anchor.example/mcp', {
    pairingStore: 'file',
    persistentTokens: true,
    multiInstance: false,
  });

  assert.equal(info.type, 'anchorread-browser-pairing');
  assert.equal(info.oauthSupported, true);
  assert.equal(info.resource, 'https://anchor.example/mcp');
  assert.equal(info.authorizationUrl, 'https://anchor.example/mcp/authorize');
  assert.equal(info.diagramsUrl, 'https://anchor.example/diagrams?mcp=authorize');
  assert.equal(info.statusUrl, 'https://anchor.example/api/mcp/authorization');
  assert.equal(info.tokenEnvironmentVariable, 'ANCHORREAD_MCP_BEARER_TOKEN');
  assert.equal(info.oauth.authorizationEndpoint, 'https://anchor.example/mcp/oauth/authorize');
  assert.equal(info.oauth.tokenEndpoint, 'https://anchor.example/mcp/oauth/token');
  assert.equal(info.oauth.registrationEndpoint, 'https://anchor.example/mcp/oauth/register');
  assert.equal(info.oauth.protectedResourceMetadata, 'https://anchor.example/.well-known/oauth-protected-resource/mcp');
  assert.equal(info.runtime.persistentTokens, true);
  assert.equal(JSON.stringify(info).includes('armcp_'), false);
  assert.equal(JSON.stringify(info).includes('managementSecret'), false);
});

test('authorization URL helpers discard caller paths and query strings', () => {
  const request = new Request('https://anchor.example/reader?next=https%3A%2F%2Fevil.example');
  assert.equal(getDiagramMcpResourceUrl(request), 'https://anchor.example/mcp');
  assert.equal(getDiagramMcpAuthorizationUrl(request), 'https://anchor.example/mcp/authorize');
  assert.equal(getDiagramMcpDiagramsUrl(request), 'https://anchor.example/diagrams?mcp=authorize');
  assert.equal(getDiagramMcpAuthorizationInfoUrl(request), 'https://anchor.example/api/mcp/authorization');
  assert.equal(getDiagramMcpOAuthAuthorizationUrl(request), 'https://anchor.example/mcp/oauth/authorize');
  assert.equal(getDiagramMcpOAuthTokenUrl(request), 'https://anchor.example/mcp/oauth/token');
  assert.equal(getDiagramMcpOAuthRegisterUrl(request), 'https://anchor.example/mcp/oauth/register');
  assert.equal(getDiagramMcpOAuthResourceMetadataUrl(request), 'https://anchor.example/.well-known/oauth-protected-resource/mcp');
  assert.equal(getDiagramMcpOAuthServerMetadataUrl(request), 'https://anchor.example/.well-known/oauth-authorization-server');
});

test('authorization metadata rejects invalid URL input', () => {
  assert.throws(() => getDiagramMcpResourceUrl('not a URL'), TypeError);
});
