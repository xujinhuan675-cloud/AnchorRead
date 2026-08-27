/**
 * Client-facing authorization metadata for the remote diagram MCP.
 *
 * AnchorRead uses OAuth for remote MCP clients and binds each approval to the
 * browser page that will execute diagram operations.
 */

const MCP_PATH = '/mcp';
const AUTHORIZATION_PATH = '/mcp/authorize';
const OAUTH_AUTHORIZATION_PATH = '/mcp/oauth/authorize';
const OAUTH_TOKEN_PATH = '/mcp/oauth/token';
const OAUTH_REGISTER_PATH = '/mcp/oauth/register';
const OAUTH_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
const OAUTH_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';
const DIAGRAMS_PATH = '/diagrams?mcp=authorize';
const AUTHORIZATION_INFO_PATH = '/api/mcp/authorization';

function requestUrl(requestOrUrl) {
  if (requestOrUrl instanceof URL) return new URL(requestOrUrl.href);
  if (typeof requestOrUrl === 'string') return new URL(requestOrUrl);
  if (requestOrUrl && typeof requestOrUrl.url === 'string') return new URL(requestOrUrl.url);
  throw new TypeError('A request or URL is required to build MCP authorization metadata.');
}

function requestOrigin(requestOrUrl) {
  const url = requestUrl(requestOrUrl);
  if (!requestOrUrl || requestOrUrl instanceof URL || typeof requestOrUrl === 'string') return url.origin;
  const forwardedHost = String(requestOrUrl.headers?.get?.('x-forwarded-host') || '').split(',')[0].trim();
  if (!forwardedHost) return url.origin;
  const forwardedProto = String(requestOrUrl.headers?.get?.('x-forwarded-proto') || '').split(',')[0].trim();
  return `${forwardedProto || url.protocol.replace(':', '')}://${forwardedHost}`;
}

function sameOriginUrl(requestOrUrl, pathname) {
  return new URL(pathname, requestOrigin(requestOrUrl)).toString();
}

/** Return the canonical resource identifier advertised to an MCP client. */
export function getDiagramMcpResourceUrl(requestOrUrl) {
  return sameOriginUrl(requestOrUrl, MCP_PATH);
}

/** Return the browser handoff page that can be opened by an MCP client. */
export function getDiagramMcpAuthorizationUrl(requestOrUrl) {
  return sameOriginUrl(requestOrUrl, AUTHORIZATION_PATH);
}

/** Return the page opened after the user accepts the browser handoff. */
export function getDiagramMcpDiagramsUrl(requestOrUrl) {
  return sameOriginUrl(requestOrUrl, DIAGRAMS_PATH);
}

/** Return a non-secret endpoint an MCP client can poll for deployment status. */
export function getDiagramMcpAuthorizationInfoUrl(requestOrUrl) {
  return sameOriginUrl(requestOrUrl, AUTHORIZATION_INFO_PATH);
}

export function getDiagramMcpOAuthAuthorizationUrl(requestOrUrl) {
  return sameOriginUrl(requestOrUrl, OAUTH_AUTHORIZATION_PATH);
}

export function getDiagramMcpOAuthTokenUrl(requestOrUrl) {
  return sameOriginUrl(requestOrUrl, OAUTH_TOKEN_PATH);
}

export function getDiagramMcpOAuthRegisterUrl(requestOrUrl) {
  return sameOriginUrl(requestOrUrl, OAUTH_REGISTER_PATH);
}

export function getDiagramMcpOAuthResourceMetadataUrl(requestOrUrl) {
  return sameOriginUrl(requestOrUrl, OAUTH_RESOURCE_METADATA_PATH);
}

export function getDiagramMcpOAuthServerMetadataUrl(requestOrUrl) {
  return sameOriginUrl(requestOrUrl, OAUTH_SERVER_METADATA_PATH);
}

/**
 * Describe the supported authorization handoff.
 *
 * The OAuth endpoints use authorization-code + PKCE. Manual static tokens are
 * intentionally not advertised or supported.
 */
export function getDiagramMcpAuthorizationInfo(requestOrUrl, runtime = {}) {
  const resource = getDiagramMcpResourceUrl(requestOrUrl);
  const authorizationUrl = getDiagramMcpAuthorizationUrl(requestOrUrl);
  const diagramsUrl = getDiagramMcpDiagramsUrl(requestOrUrl);
  return {
    type: 'anchorread-oauth',
    resource,
    mcpEndpoint: resource,
    authorizationUrl,
    diagramsUrl,
    statusUrl: getDiagramMcpAuthorizationInfoUrl(requestOrUrl),
    oauthSupported: true,
    oauth: {
      authorizationEndpoint: getDiagramMcpOAuthAuthorizationUrl(requestOrUrl),
      tokenEndpoint: getDiagramMcpOAuthTokenUrl(requestOrUrl),
      registrationEndpoint: getDiagramMcpOAuthRegisterUrl(requestOrUrl),
      protectedResourceMetadata: getDiagramMcpOAuthResourceMetadataUrl(requestOrUrl),
      authorizationServerMetadata: getDiagramMcpOAuthServerMetadataUrl(requestOrUrl),
      responseTypesSupported: ['code'],
      grantTypesSupported: ['authorization_code', 'refresh_token'],
      codeChallengeMethodsSupported: ['S256'],
      scopesSupported: ['diagrams:read', 'diagrams:write'],
    },
    browser: {
      required: true,
      handoffUrl: diagramsUrl,
      requiresUserConfirmation: true,
    },
    runtime: {
      pairingStore: runtime.pairingStore || 'unknown',
      persistentAccessTokens: runtime.persistentTokens === true,
      oauthStore: runtime.oauthStore || 'unknown',
      persistentOAuth: runtime.persistentOAuth === true,
      multiInstance: runtime.multiInstance === true,
    },
  };
}
