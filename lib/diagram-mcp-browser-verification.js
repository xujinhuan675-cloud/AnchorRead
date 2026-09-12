import { buildDiagramWorkspaceUrl } from './diagram-mcp-links.js';
import { isSafeDiagramWorkspaceUrl } from './diagram-public-origin.js';
import {
  createBrowserBuildStaleError,
  diagramAgentBuildCompatibility,
  getDiagramAgentBuildInfo,
  serializeDiagramAgentError,
} from './diagram-agent-protocol.js';

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

export async function verifyDiagramBrowserConnection({ request, auth, submitTool, transportRuntime = {} }) {
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
    browserBinding: check(
      !remoteOAuth || Boolean(auth?.binding?.bindingId) ? 'PASS' : 'FAIL',
      remoteOAuth
        ? (auth?.binding?.bindingId ? 'OAuth token matches its server-issued browser binding.' : 'OAuth token has no server-issued browser binding.')
        : 'Loopback MCP requests do not require an OAuth browser binding.',
    ),
    workspaceUrl: check(safeWorkspaceUrl ? 'PASS' : 'FAIL', safeWorkspaceUrl ? workspaceUrl : 'Workspace URL is not browser-safe.'),
    browserSessionOnline: check('FAIL', 'No online browser session is paired with this MCP authorization.'),
    browserBuild: check('FAIL', 'The browser build and diagram protocol have not been verified.'),
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
  if (remoteOAuth && !auth?.binding?.bindingId) {
    return {
      ok: false,
      code: 'BROWSER_BINDING_UPGRADE_REQUIRED',
      workspaceUrl,
      checks,
      ...recovery(workspaceUrl, 'reauthorize_mcp'),
    };
  }
  if (auth?.binding?.online === true && auth?.binding?.versionCompatible === false) {
    const stale = createBrowserBuildStaleError(auth.binding.actual || auth.binding, { workspaceUrl });
    return {
      ok: false,
      ...serializeDiagramAgentError(stale),
      workspaceUrl,
      checks,
    };
  }
  // A file-backed pairing store only knows process-local presence. With the
  // shared Redis broker, the authoritative online check is the round trip
  // below because the browser poll may be served by another Node process.
  if (remoteOAuth && auth?.binding?.connected !== true && transportRuntime.sharedRequestBroker !== true) {
    return {
      ok: false,
      code: 'BROWSER_SESSION_OFFLINE',
      workspaceUrl,
      checks,
      pairing: { tokenBoundToWorkspace: true, tokenBoundToBrowser: true, browserSessionOnline: false },
      ...recovery(workspaceUrl),
    };
  }

  try {
    const result = await submitTool('verify_browser_connection', {}, {
      signal: request?.signal,
      binding: auth?.binding || null,
      tokenId: auth?.token?.id || '',
    });
    const compatibility = diagramAgentBuildCompatibility(result?.browserVersion);
    if (!compatibility.compatible) {
      throw createBrowserBuildStaleError(result?.browserVersion, { expected: getDiagramAgentBuildInfo(), workspaceUrl });
    }
    const storageReadable = result?.writable === true && Number.isInteger(result?.diagramCount);
    checks.browserSessionOnline = check('PASS', 'The paired browser session answered the MCP request.');
    checks.browserBuild = check('PASS', `Browser build ${compatibility.actual.buildSha} uses diagram protocol ${compatibility.actual.protocolVersion}.`);
    checks.browserStorageRead = check(
      storageReadable ? 'PASS' : 'FAIL',
      storageReadable ? 'AnchorRead read the browser IndexedDB diagram store.' : 'The browser returned an unexpected verification payload.',
    );
    checks.roundTrip = check(
      storageReadable ? 'PASS' : 'FAIL',
      storageReadable ? 'MCP OAuth, compatible browser routing, IndexedDB read, and response completed.' : 'The browser response did not satisfy the verification contract.',
    );
    return {
      ok: storageReadable,
      code: storageReadable ? 'OK' : 'INVALID_BROWSER_RESPONSE',
      workspaceUrl,
      checks,
      diagramCount: storageReadable ? result.diagramCount : null,
      browserVersion: compatibility.actual,
      expectedBrowserVersion: compatibility.expected,
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
    if (code === 'BROWSER_BUILD_STALE') checks.browserBuild = check('FAIL', String(error?.message || error));
    checks.roundTrip = check('FAIL', `Round trip failed with ${code}.`);
    return {
      ok: false,
      code,
      workspaceUrl,
      checks,
      ...(code === 'BROWSER_BUILD_STALE' ? serializeDiagramAgentError(error) : recovery(workspaceUrl)),
    };
  }
}
