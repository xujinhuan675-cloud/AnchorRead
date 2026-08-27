/**
 * Client-facing authorization metadata for the remote diagram MCP.
 *
 * AnchorRead currently uses browser pairing plus long-lived Bearer tokens,
 * rather than an OAuth authorization server. Keep this metadata explicit so
 * clients can offer a one-click browser handoff without mistaking it for OAuth.
 */

const MCP_PATH = '/mcp';
const AUTHORIZATION_PATH = '/mcp/authorize';
const DIAGRAMS_PATH = '/diagrams?mcp=authorize';
const AUTHORIZATION_INFO_PATH = '/api/mcp/authorization';

function requestUrl(requestOrUrl) {
  if (requestOrUrl instanceof URL) return new URL(requestOrUrl.href);
  if (typeof requestOrUrl === 'string') return new URL(requestOrUrl);
  if (requestOrUrl && typeof requestOrUrl.url === 'string') return new URL(requestOrUrl.url);
  throw new TypeError('A request or URL is required to build MCP authorization metadata.');
}

function sameOriginUrl(requestOrUrl, pathname) {
  const url = requestUrl(requestOrUrl);
  return new URL(pathname, url.origin).toString();
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

/**
 * Describe the supported authorization handoff.
 *
 * `oauthSupported` is intentionally false: exposing an authorization URL is
 * not the same as implementing RFC 8414/9728 or issuing OAuth access tokens.
 */
export function getDiagramMcpAuthorizationInfo(requestOrUrl, runtime = {}) {
  const resource = getDiagramMcpResourceUrl(requestOrUrl);
  const authorizationUrl = getDiagramMcpAuthorizationUrl(requestOrUrl);
  const diagramsUrl = getDiagramMcpDiagramsUrl(requestOrUrl);
  return {
    type: 'anchorread-browser-pairing',
    resource,
    mcpEndpoint: resource,
    authorizationUrl,
    diagramsUrl,
    statusUrl: getDiagramMcpAuthorizationInfoUrl(requestOrUrl),
    oauthSupported: false,
    tokenTransport: 'authorization_header_bearer',
    tokenEnvironmentVariable: 'ANCHORREAD_MCP_BEARER_TOKEN',
    clientAction: {
      type: 'open_url',
      url: authorizationUrl,
      label: 'Open AnchorRead authorization',
    },
    browser: {
      required: true,
      handoffUrl: diagramsUrl,
      requiresUserConfirmation: true,
    },
    runtime: {
      pairingStore: runtime.pairingStore || 'unknown',
      persistentTokens: runtime.persistentTokens === true,
      multiInstance: runtime.multiInstance === true,
    },
  };
}

