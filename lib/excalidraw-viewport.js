function zoomValue(value) {
  return value && typeof value === 'object' ? value.value : value;
}

/**
 * Produce a stable key for the viewport values owned by a persisted scene.
 * Runtime Excalidraw state is intentionally excluded so element edits do not
 * look like an external camera update.
 */
export function persistedViewportSyncKey(appState) {
  const zoom = zoomValue(appState?.zoom);
  return JSON.stringify({
    scrollX: Number.isFinite(appState?.scrollX) ? appState.scrollX : null,
    scrollY: Number.isFinite(appState?.scrollY) ? appState.scrollY : null,
    zoom: Number.isFinite(zoom) ? zoom : null,
    viewModeEnabled: appState?.viewModeEnabled === true,
  });
}

/**
 * Hydrate a mounted canvas only for its first API instance or a new incoming
 * persisted viewport. A user can pan/zoom or drag an element while the
 * persisted scene still carries the previous camera values.
 */
export function shouldApplyPersistedViewport({ apiChanged, previousKey, nextKey }) {
  return apiChanged || previousKey === null || previousKey === undefined || previousKey !== nextKey;
}
