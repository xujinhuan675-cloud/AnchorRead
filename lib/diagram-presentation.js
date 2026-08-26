export const DIAGRAM_PRESENTATION_VERSION = 1;
export const DEFAULT_PRESENTATION_STEP_DURATION_MS = 1200;
export const DEFAULT_PRESENTATION_TRANSITION_MS = 450;
export const MAX_PRESENTATION_STEPS = 100;

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 500);
}

function finiteNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function normalizePresentationStep(step, index = 0) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new Error(`Presentation step ${index + 1} must be an object.`);
  }
  const id = String(step.id || `step-${index + 1}`).trim();
  if (!id) throw new Error(`Presentation step ${index + 1} requires an id.`);
  const camera = step.camera && typeof step.camera === 'object' ? {
    ...(Number.isFinite(Number(step.camera.scrollX)) ? { scrollX: Number(step.camera.scrollX) } : {}),
    ...(Number.isFinite(Number(step.camera.scrollY)) ? { scrollY: Number(step.camera.scrollY) } : {}),
    ...(Number.isFinite(Number(step.camera.zoom)) && Number(step.camera.zoom) > 0 ? { zoom: Number(step.camera.zoom) } : {}),
  } : null;
  return {
    id,
    title: String(step.title || '').trim(),
    durationMs: Math.max(0, Math.min(60_000, finiteNumber(step.durationMs, DEFAULT_PRESENTATION_STEP_DURATION_MS))),
    transitionMs: Math.max(0, Math.min(10_000, finiteNumber(step.transitionMs, DEFAULT_PRESENTATION_TRANSITION_MS))),
    visibleElementIds: stringList(step.visibleElementIds),
    focusElementIds: stringList(step.focusElementIds),
    highlightElementIds: stringList(step.highlightElementIds),
    ...(camera && Object.keys(camera).length > 0 ? { camera } : {}),
  };
}

export function normalizePresentationSpec(value) {
  if (value == null || value === false) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Presentation must be an object or null.');
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new Error('Presentation requires at least one step.');
  }
  if (value.steps.length > MAX_PRESENTATION_STEPS) {
    throw new Error(`Presentation cannot contain more than ${MAX_PRESENTATION_STEPS} steps.`);
  }
  return {
    version: DIAGRAM_PRESENTATION_VERSION,
    title: String(value.title || '').trim(),
    steps: value.steps.map((step, index) => normalizePresentationStep(step, index)),
  };
}

export function getPresentationSpec(drawing) {
  return normalizePresentationSpec(drawing?.presentation ?? drawing?.presentationSpec ?? null);
}

export function getPresentationStep(spec, index) {
  if (!spec?.steps?.length) return null;
  const safeIndex = Math.max(0, Math.min(spec.steps.length - 1, Number.isInteger(index) ? index : 0));
  return spec.steps[safeIndex];
}
