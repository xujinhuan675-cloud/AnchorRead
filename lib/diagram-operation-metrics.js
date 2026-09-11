function clockNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function serializedByteLength(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
  } catch {
    return 0;
  }
}

function rounded(value) {
  return Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
}

export function createDiagramOperationMetrics({
  operation = 'unknown',
  transport = 'unknown',
  payload,
  now = clockNow,
} = {}) {
  const startedAt = now();
  const stages = Object.create(null);
  let conflictRetries = 0;

  return {
    async measure(stage, task) {
      const stageStartedAt = now();
      try {
        return await task();
      } finally {
        stages[stage] = rounded((stages[stage] || 0) + (now() - stageStartedAt));
      }
    },
    recordConflictRetry() {
      conflictRetries += 1;
    },
    finish(result, outcome = 'ok') {
      return {
        operation,
        transport,
        outcome,
        mcpTotalMs: rounded(now() - startedAt),
        requestBytes: serializedByteLength(payload),
        responseBytes: serializedByteLength(result),
        conflictRetries,
        ...stages,
      };
    },
  };
}

export function mergeDiagramOperationMetrics(result, metrics) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  return {
    ...result,
    operationMetrics: {
      ...(result.operationMetrics || {}),
      ...(metrics || {}),
    },
  };
}
