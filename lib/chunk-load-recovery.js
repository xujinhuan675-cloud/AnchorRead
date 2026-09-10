import { normalizeSentryRoute, safeTelemetryIdentifier } from './sentry-config.js';

const CHUNK_ERROR_PATTERN = /ChunkLoadError|Loading chunk \S+ failed|Failed to fetch dynamically imported module|Importing a module script failed/iu;

export function isChunkLoadError(error) {
  let current = error;
  for (let depth = 0; current && depth < 3; depth += 1) {
    if (current?.name === 'ChunkLoadError' || CHUNK_ERROR_PATTERN.test(String(current?.message || current))) {
      return true;
    }
    current = current?.cause;
  }
  return false;
}

export function recoverChunkLoadError(error, {
  storage = globalThis.sessionStorage,
  location = globalThis.location,
  release = process.env.NEXT_PUBLIC_SENTRY_RELEASE,
} = {}) {
  if (!isChunkLoadError(error) || typeof location?.reload !== 'function') return false;
  const safeRelease = safeTelemetryIdentifier(release, 'unknown');
  const route = normalizeSentryRoute(location.pathname || '/');
  const recoveryKey = `anchorread.chunk-reload:${safeRelease}:${route}`;
  try {
    if (storage?.getItem?.(recoveryKey) === '1') return false;
    storage?.setItem?.(recoveryKey, '1');
    location.reload();
    return true;
  } catch {
    return false;
  }
}
