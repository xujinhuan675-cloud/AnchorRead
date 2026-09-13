export const DIAGRAM_AGENT_PROTOCOL_VERSION = '2';

const FALLBACK_BUILD_VERSION = '0.1.0';
const FALLBACK_BUILD_SHA = 'development';

function normalized(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

export function getDiagramAgentBuildInfo() {
  return Object.freeze({
    buildSha: normalized(process.env.NEXT_PUBLIC_ANCHORREAD_BUILD_SHA, FALLBACK_BUILD_SHA),
    buildVersion: normalized(process.env.NEXT_PUBLIC_ANCHORREAD_BUILD_VERSION, FALLBACK_BUILD_VERSION),
    protocolVersion: DIAGRAM_AGENT_PROTOCOL_VERSION,
  });
}

export function normalizeDiagramAgentBuildInfo(value = {}) {
  return {
    buildSha: normalized(value.buildSha),
    buildVersion: normalized(value.buildVersion),
    protocolVersion: normalized(value.protocolVersion),
  };
}

export function normalizeDiagramAgentRequests(payload) {
  return Array.isArray(payload?.requests) ? payload.requests : [];
}

export function diagramAgentBuildCompatibility(actual, expected = getDiagramAgentBuildInfo()) {
  const normalizedActual = normalizeDiagramAgentBuildInfo(actual);
  const normalizedExpected = normalizeDiagramAgentBuildInfo(expected);
  const missing = Object.entries(normalizedActual)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const mismatched = Object.keys(normalizedExpected)
    .filter((key) => normalizedActual[key] && normalizedActual[key] !== normalizedExpected[key]);
  return {
    compatible: missing.length === 0 && mismatched.length === 0,
    expected: normalizedExpected,
    actual: normalizedActual,
    missing,
    mismatched,
  };
}

export function browserBuildRecovery(workspaceUrl = '') {
  return {
    action: 'refresh_workspace_page',
    url: normalized(workspaceUrl, '/diagrams'),
    retryTool: 'verify_browser_connection',
    message: 'Refresh the specified AnchorRead workspace page, wait for it to reconnect, then run verify_browser_connection again.',
  };
}

export function createBrowserBuildStaleError(actual, { expected, workspaceUrl } = {}) {
  const compatibility = diagramAgentBuildCompatibility(actual, expected);
  const error = new Error('The connected browser workspace build is stale or incompatible. Refresh it before writing diagrams.');
  error.code = 'BROWSER_BUILD_STALE';
  error.expected = compatibility.expected;
  error.actual = compatibility.actual;
  error.missing = compatibility.missing;
  error.mismatched = compatibility.mismatched;
  error.recovery = browserBuildRecovery(workspaceUrl);
  return error;
}

export function assertDiagramAgentBuildCompatible(actual, options = {}) {
  const compatibility = diagramAgentBuildCompatibility(actual, options.expected);
  if (!compatibility.compatible) throw createBrowserBuildStaleError(actual, options);
  return compatibility;
}

export function serializeDiagramAgentError(error) {
  return {
    code: String(error?.code || 'DIAGRAM_AGENT_ERROR'),
    message: String(error?.message || error || 'Diagram agent request failed.'),
    ...(error?.expected ? { expected: error.expected } : {}),
    ...(error?.actual ? { actual: error.actual } : {}),
    ...(Array.isArray(error?.missing) ? { missing: error.missing } : {}),
    ...(Array.isArray(error?.mismatched) ? { mismatched: error.mismatched } : {}),
    ...(error?.recovery ? { recovery: error.recovery } : {}),
    ...(error?.expectedRevision !== undefined ? { expectedRevision: error.expectedRevision } : {}),
    ...(error?.actualRevision !== undefined ? { actualRevision: error.actualRevision } : {}),
    ...(error?.retryExhausted === true ? { retryExhausted: true } : {}),
    ...(error?.conflictRetries !== undefined ? { conflictRetries: error.conflictRetries } : {}),
    ...(error?.maxConflictRetries !== undefined ? { maxConflictRetries: error.maxConflictRetries } : {}),
    ...(Array.isArray(error?.elementIds) ? { elementIds: error.elementIds } : {}),
    ...(error?.preflight && typeof error.preflight === 'object' ? { preflight: error.preflight } : {}),
  };
}
