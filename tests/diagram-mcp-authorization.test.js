import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getDiagramMcpAuthorizationInfo,
  getDiagramMcpAuthorizationInfoUrl,
  getDiagramMcpAuthorizationUrl,
  getDiagramMcpCodexOAuthSetup,
  getDiagramMcpCodexPersonalTokenConfig,
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

test('Codex connection helpers produce one-paste OAuth commands and Personal Token config', () => {
  const endpoint = 'https://anchor.example/mcp';
  assert.equal(
    getDiagramMcpCodexOAuthSetup(endpoint),
    [
      'codex mcp add anchor-read-diagram --url https://anchor.example/mcp',
      'codex mcp login anchor-read-diagram',
    ].join('\n'),
  );
  assert.equal(
    getDiagramMcpCodexPersonalTokenConfig(endpoint, 'armcp_personal-secret'),
    [
      '[mcp_servers.anchor-read-diagram]',
      'enabled = true',
      'url = "https://anchor.example/mcp"',
      '',
      '[mcp_servers.anchor-read-diagram.http_headers]',
      'Authorization = "Bearer armcp_personal-secret"',
    ].join('\n'),
  );
  assert.throws(() => getDiagramMcpCodexPersonalTokenConfig(endpoint, ''), TypeError);
});

test('authorization metadata rejects invalid URL input', () => {
  assert.throws(() => getDiagramMcpResourceUrl('not a URL'), TypeError);
});

test('browser connection surface exposes OAuth and Personal Token controls', () => {
  const pairingRoute = readFileSync(new URL('../app/api/mcp/pairing/route.js', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../components/McpConnectionPanel.jsx', import.meta.url), 'utf8');
  const topNav = readFileSync(new URL('../components/AppTopNav.jsx', import.meta.url), 'utf8');
  const approvalRoute = readFileSync(new URL('../app/api/mcp/oauth/approve/route.js', import.meta.url), 'utf8');
  const tokenRoute = readFileSync(new URL('../app/mcp/oauth/token/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(pairingRoute, /create-token|rotate-token|revoke-token/u);
  assert.doesNotMatch(panel, /ANCHORREAD_MCP_BEARER_TOKEN|bearer_token_env_var|create-token|rotate-token|revoke-token/u);
  assert.match(panel, /OAuth authorization|OAuth 授权/u);
  assert.match(panel, /createPersonalToken|Personal Token|个人 Token/u);
  assert.match(panel, /View authorization|查看授权/u);
  assert.match(panel, /Revoke authorization|撤销授权/u);
  assert.match(panel, /方式一：OAuth 自动授权|Option 1: OAuth authorization/u);
  assert.match(panel, /方式二：个人 Token|Option 2: Personal Token/u);
  assert.match(panel, /copyOAuthSetup/u);
  assert.match(panel, /copyPersonalConfig/u);
  assert.match(panel, /getDiagramMcpCodexPersonalTokenConfig/u);
  assert.doesNotMatch(panel, /重新授权命令|Reauthorization command/u);
  assert.match(panel, /disabled=\{Boolean\(busy\)\} onClick=\{approveOAuth\}/u);
  assert.match(panel, /disabled=\{Boolean\(busy\)\} onClick=\{viewAuthorizations\}/u);
  assert.match(panel, /disabled=\{Boolean\(busy\)\} onClick=\{\(\) => revokeAuthorizations\(\)\}/u);
  assert.match(pairingRoute, /authorizations/u);
  assert.match(pairingRoute, /revoke-authorizations/u);
  assert.match(pairingRoute, /create-personal-token/u);
  assert.match(pairingRoute, /action === 'heartbeat'/u);
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
