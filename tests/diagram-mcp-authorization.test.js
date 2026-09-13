import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    oauthStore: 'file',
    persistentOAuth: true,
    multiInstance: false,
    requestBroker: 'redis',
    sharedRequestBroker: true,
    requestRoutingMultiInstance: true,
    mcpSessionAffinityRequired: true,
    instanceId: 'anchorread-test-1',
  });

  assert.equal(info.type, 'anchorread-oauth');
  assert.equal(info.oauthSupported, true);
  assert.equal(info.resource, 'https://anchor.example/mcp');
  assert.equal(info.authorizationUrl, 'https://anchor.example/mcp/authorize');
  assert.equal(info.diagramsUrl, 'https://anchor.example/diagrams?mcp=authorize');
  assert.equal(info.statusUrl, 'https://anchor.example/api/mcp/authorization');
  assert.equal(info.oauth.authorizationEndpoint, 'https://anchor.example/mcp/oauth/authorize');
  assert.equal(info.oauth.tokenEndpoint, 'https://anchor.example/mcp/oauth/token');
  assert.equal(info.oauth.registrationEndpoint, 'https://anchor.example/mcp/oauth/register');
  assert.equal(info.oauth.protectedResourceMetadata, 'https://anchor.example/.well-known/oauth-protected-resource/mcp');
  assert.equal(info.runtime.persistentAccessTokens, true);
  assert.equal(info.runtime.persistentOAuth, true);
  assert.equal(info.runtime.oauthStore, 'file');
  assert.equal(info.runtime.multiInstance, false);
  assert.equal(info.runtime.requestBroker, 'redis');
  assert.equal(info.runtime.sharedRequestBroker, true);
  assert.equal(info.runtime.requestRoutingMultiInstance, true);
  assert.equal(info.runtime.mcpSessionAffinityRequired, true);
  assert.equal(info.runtime.instanceId, 'anchorread-test-1');
  assert.equal(JSON.stringify(info).includes('armcp_'), false);
  assert.equal(JSON.stringify(info).includes('managementSecret'), false);
  assert.equal(JSON.stringify(info).includes('tokenEnvironmentVariable'), false);
  assert.equal(JSON.stringify(info).includes('bearer_token_env_var'), false);
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

test('browser connection surface exposes OAuth only', () => {
  const pairingRoute = readFileSync(new URL('../app/api/mcp/pairing/route.js', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../components/McpConnectionPanel.jsx', import.meta.url), 'utf8');
  const topNav = readFileSync(new URL('../components/AppTopNav.jsx', import.meta.url), 'utf8');
  const approvalRoute = readFileSync(new URL('../app/api/mcp/oauth/approve/route.js', import.meta.url), 'utf8');
  const tokenRoute = readFileSync(new URL('../app/mcp/oauth/token/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(pairingRoute, /create-token|rotate-token|revoke-token/u);
  assert.doesNotMatch(panel, /ANCHORREAD_MCP_BEARER_TOKEN|bearer_token_env_var|create-token|rotate-token|revoke-token/u);
  assert.match(panel, /OAuth authorization|OAuth 授权/u);
  assert.match(panel, /View authorization|查看授权/u);
  assert.match(panel, /Revoke authorization|撤销授权/u);
  assert.match(panel, /codex mcp login anchor-read-diagram/u);
  assert.match(panel, /其他 MCP 客户端/u);
  assert.match(panel, /replace the leading codex with the client name, such as Claude/u);
  assert.match(panel, /copyReauthorizationCommand/u);
  assert.match(panel, /disabled=\{Boolean\(busy\)\} onClick=\{approveOAuth\}/u);
  assert.match(panel, /disabled=\{Boolean\(busy\)\} onClick=\{viewAuthorizations\}/u);
  assert.match(panel, /disabled=\{Boolean\(busy\)\} onClick=\{\(\) => revokeAuthorizations\(\)\}/u);
  assert.match(pairingRoute, /authorizations/u);
  assert.match(pairingRoute, /revoke-authorizations/u);
  assert.match(pairingRoute, /token\.status === 'active'/u);
  assert.match(panel, /submitOAuthApproval\(\{ silent: true \}\)/u);
  assert.match(panel, /payload\.refreshTokensRevoked/u);
  assert.match(panel, /oauthApprovalInFlightRef/u);
  assert.doesNotMatch(panel, /oauthApprovalStartedRef/u);
  assert.match(topNav, /const closeMcpPanel = \(\) =>/u);
  assert.ok(approvalRoute.indexOf('oauthStore.getTransaction') < approvalRoute.indexOf('ensureBrowserBinding'));
  assert.doesNotMatch(approvalRoute, /registerConnection\(context, \{ replace: true \}\)/u);
  assert.match(approvalRoute, /approveTransaction\(body\?\.transaction, connection\)/u);
  assert.match(tokenRoute, /BROWSER_BINDING_MISMATCH.+BROWSER_BINDING_UPGRADE_REQUIRED/u);
});
