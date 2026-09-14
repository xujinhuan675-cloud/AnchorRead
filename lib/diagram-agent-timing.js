export const DIAGRAM_AGENT_BRIDGE_DEFAULT_TIMEOUT_MS = 120_000;
export const DIAGRAM_AGENT_BRIDGE_MAX_TIMEOUT_MS = 240_000;
export const DIAGRAM_AGENT_REQUEST_TTL_GRACE_MS = 30_000;
export const DIAGRAM_AGENT_REQUEST_MAX_TTL_MS = 5 * 60_000;

export function normalizeDiagramAgentBridgeTimeout(value, { minMs = 1_000 } = {}) {
  const configured = Number(value);
  return Math.max(minMs, Math.min(
    Number.isFinite(configured) && configured > 0
      ? configured
      : DIAGRAM_AGENT_BRIDGE_DEFAULT_TIMEOUT_MS,
    DIAGRAM_AGENT_BRIDGE_MAX_TIMEOUT_MS,
  ));
}

export function createDiagramAgentRequestTiming({ timeoutMs, ttlMs } = {}) {
  const normalizedTimeoutMs = normalizeDiagramAgentBridgeTimeout(timeoutMs);
  const requestedTtlMs = Number(ttlMs);
  const minimumTtlMs = normalizedTimeoutMs + DIAGRAM_AGENT_REQUEST_TTL_GRACE_MS;
  return {
    timeoutMs: normalizedTimeoutMs,
    ttlMs: Math.min(
      DIAGRAM_AGENT_REQUEST_MAX_TTL_MS,
      Math.max(
        minimumTtlMs,
        Number.isFinite(requestedTtlMs) && requestedTtlMs > 0 ? requestedTtlMs : 0,
      ),
    ),
  };
}
