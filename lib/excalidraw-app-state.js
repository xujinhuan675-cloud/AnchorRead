const DOCUMENT_APP_STATE_FIELDS = [
  'viewBackgroundColor',
  'gridSize',
  'gridStep',
  'gridModeEnabled',
  'frameRendering',
  'viewModeEnabled',
  'exportBackground',
  'exportEmbedScene',
  'exportWithDarkMode',
  'exportScale',
];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function persistedViewport(appState) {
  if (!isRecord(appState)) return {};
  const viewport = {};
  if (Number.isFinite(appState.scrollX)) viewport.scrollX = appState.scrollX;
  if (Number.isFinite(appState.scrollY)) viewport.scrollY = appState.scrollY;
  const zoomValue = isRecord(appState.zoom) ? appState.zoom.value : appState.zoom;
  if (Number.isFinite(zoomValue)) viewport.zoom = { value: zoomValue };
  return viewport;
}

/**
 * Keep only drawing-owned app state. Excalidraw's onChange also includes
 * transient UI and pointer state, which must never become a new scene input.
 */
export function normalizePersistedExcalidrawAppState(appState) {
  if (!isRecord(appState)) return {};
  const persisted = {};
  for (const field of DOCUMENT_APP_STATE_FIELDS) {
    if (Object.hasOwn(appState, field)) persisted[field] = appState[field];
  }
  return { ...persisted, ...persistedViewport(appState) };
}

/**
 * Merge a canvas callback without treating a user pan/zoom as a new saved
 * viewport. Explicit viewports arrive through drawing hydration instead.
 */
export function mergeCanvasAppStateForPersistence(currentAppState, canvasAppState) {
  const current = normalizePersistedExcalidrawAppState(currentAppState);
  const canvas = normalizePersistedExcalidrawAppState(canvasAppState);
  const { scrollX, scrollY, zoom, ...canvasDocumentState } = canvas;
  return { ...current, ...canvasDocumentState };
}
