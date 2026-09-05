import { buildDiagramWorkspaceUrl } from './diagram-mcp-links.js';
import { isSafeDiagramWorkspaceUrl } from './diagram-public-origin.js';

function check(status, detail) {
  return { status, detail };
}

function recovery(workspaceUrl, action = 'open_workspace_then_retry') {
  return {
    nextAction: action,
    nextActionDetails: {
      url: workspaceUrl,
      retryTool: 'verify_browser_connection',
      ifStillOffline: {
        action: 'reauthorize_in_target_browser',
        command: 'codex mcp login anchorread',
      },
    },
    openRequested: true,
    openAction: 'open_url_if_supported',
    openResource: { kind: 'workspace', url: workspaceUrl },
  };
}

export async function verifyDiagramBrowserConnection({ request, auth, submitTool }) {
  const workspaceUrl = buildDiagramWorkspaceUrl({ baseUrl: request });
  const remoteOAuth = Boolean(auth?.token?.id);
  const locallyAuthorized = auth?.local === true;
  const oauthAuthenticated = remoteOAuth || locallyAuthorized;
  const safeWorkspaceUrl = isSafeDiagramWorkspaceUrl(workspaceUrl);
  const checks = {
    mcpOAuth: check(
      oauthAuthenticated ? 'PASS' : 'FAIL',
      remoteOAuth ? 'OAuth bearer token authenticated.' : (locallyAuthorized ? 'Loopback MCP request authorized; OAuth is not required.' : 'OAuth bearer token is missing or invalid.'),
    ),
    workspaceUrl: check(safeWorkspaceUrl ? 'PASS' : 'FAIL', safeWorkspaceUrl ? workspaceUrl : 'Workspace URL is not browser-safe.'),
    browserSessionOnline: check('FAIL', 'No online browser session is paired with this MCP authorization.'),
    browserStorageRead: check('FAIL', 'Browser IndexedDB has not been read.'),
    roundTrip: check('FAIL', 'The MCP-to-browser-to-IndexedDB round trip has not completed.'),
  };

  if (!oauthAuthenticated) {
    return {
      ok: false,
      code: 'MCP_OAUTH_FAILED',
      workspaceUrl,
      checks,
      ...recovery(workspaceUrl, 'authenticate_mcp'),
    };
  }
  if (!safeWorkspaceUrl) {
    return {
      ok: false,
      code: 'WORKSPACE_URL_UNSAFE',
      workspaceUrl,
      checks,
      ...recovery(workspaceUrl, 'fix_public_workspace_url'),
    };
  }
  if (remoteOAuth && auth?.binding?.connected !== true) {
    return {
      ok: false,
      code: 'BROWSER_SESSION_OFFLINE',
      workspaceUrl,
      checks,
      pairing: { tokenBoundToWorkspace: true, browserSessionOnline: false },
      ...recovery(workspaceUrl),
    };
  }

  try {
    const diagrams = await submitTool('list_diagrams', {}, {
      signal: request?.signal,
      binding: auth?.binding || null,
      tokenId: auth?.token?.id || '',
    });
    const storageReadable = Array.isArray(diagrams);
    checks.browserSessionOnline = check('PASS', 'The paired browser session answered the MCP request.');
    checks.browserStorageRead = check(
      storageReadable ? 'PASS' : 'FAIL',
      storageReadable ? 'AnchorRead read the browser IndexedDB diagram store.' : 'The browser returned an unexpected list_diagrams payload.',
    );
    checks.roundTrip = check(
      storageReadable ? 'PASS' : 'FAIL',
      storageReadable ? 'MCP OAuth, browser routing, IndexedDB read, and response completed.' : 'The browser response did not satisfy the list_diagrams contract.',
    );
    return {
      ok: storageReadable,
      code: storageReadable ? 'OK' : 'INVALID_BROWSER_RESPONSE',
      workspaceUrl,
      checks,
      diagramCount: storageReadable ? diagrams.length : null,
      nextAction: storageReadable ? 'none' : 'inspect_browser_response',
    };
  } catch (error) {
    const code = String(error?.code || 'BROWSER_ROUND_TRIP_FAILED');
    const browserOffline = ['BROWSER_SESSION_OFFLINE', 'BRIDGE_TIMEOUT'].includes(code);
    checks.browserSessionOnline = check(
      browserOffline ? 'FAIL' : 'PASS',
      browserOffline ? String(error?.message || error) : 'The browser session answered, but storage verification failed.',
    );
    checks.browserStorageRead = check('FAIL', String(error?.message || error));
    checks.roundTrip = check('FAIL', `Round trip failed with ${code}.`);
    return {
      ok: false,
      code,
      workspaceUrl,
      checks,
      ...recovery(workspaceUrl),
    };
  }
}
