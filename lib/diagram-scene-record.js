import { normalizeExcalidrawScene, parseExcalidrawScene } from './excalidraw-scene.js';

export const DIAGRAM_SCENE_RECORD_VERSION = 1;
export const MAX_DIAGRAM_REVISIONS = 30;

function cloneValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function finiteRevision(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function revisionConflict(expectedRevision, actualRevision) {
  const error = new Error(
    `Diagram revision conflict: expected ${expectedRevision}, current ${actualRevision}.`,
  );
  error.code = 'REVISION_CONFLICT';
  error.expectedRevision = expectedRevision;
  error.actualRevision = actualRevision;
  return error;
}

export function getDiagramRevision(drawing) {
  return finiteRevision(drawing?.revision);
}

export function getDrawingScene(drawing) {
  if (!drawing || typeof drawing !== 'object') {
    throw new TypeError('A drawing record is required.');
  }
  if (drawing.engine && drawing.engine !== 'excalidraw') {
    throw new Error(`Drawing ${drawing.id || '(unknown)'} is not an Excalidraw drawing.`);
  }
  return parseExcalidrawScene(
    drawing.scene
      || drawing.variants?.excalidraw?.scene
      || drawing.source
      || [],
  );
}

export function createDiagramRevision({
  drawingId,
  revision,
  scene,
  author = 'user',
  reason = 'edit',
  createdAt = Date.now(),
} = {}) {
  if (!drawingId) throw new TypeError('A drawingId is required for a revision.');
  return {
    type: 'anchor-read-diagram-revision',
    version: DIAGRAM_SCENE_RECORD_VERSION,
    id: `${drawingId}:r${revision}`,
    drawingId,
    revision: finiteRevision(revision),
    author: typeof author === 'string' && author.trim() ? author.trim() : 'user',
    reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'edit',
    createdAt,
    scene: normalizeExcalidrawScene(scene),
  };
}

export function listDiagramRevisions(drawing) {
  return Array.isArray(drawing?.revisionHistory)
    ? drawing.revisionHistory.map(cloneValue)
    : [];
}

export function findDiagramRevision(drawing, revisionOrId) {
  const target = String(revisionOrId);
  return listDiagramRevisions(drawing).find((item) => (
    String(item.id) === target || String(item.revision) === target
  )) || null;
}

/**
 * Commit a scene with optimistic concurrency protection.
 * Existing drawings remain readable: legacy source arrays are promoted to a
 * complete scene on the first commit, while source stays as the legacy array
 * serialization used by current Mermaid/Excalidraw code paths.
 */
export function commitDiagramScene(drawing, scene, {
  expectedRevision,
  author = 'user',
  reason = 'edit',
  now = Date.now(),
  maxRevisions = MAX_DIAGRAM_REVISIONS,
} = {}) {
  if (!drawing || typeof drawing !== 'object') throw new TypeError('A drawing record is required.');
  const currentRevision = getDiagramRevision(drawing);
  if (expectedRevision !== undefined && expectedRevision !== null) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError('expectedRevision must be a non-negative integer.');
    }
    if (expectedRevision !== currentRevision) {
      throw revisionConflict(expectedRevision, currentRevision);
    }
  }

  const normalized = normalizeExcalidrawScene(scene);
  const nextRevision = currentRevision + 1;
  const revision = createDiagramRevision({
    drawingId: drawing.id,
    revision: nextRevision,
    scene: normalized,
    author,
    reason,
    createdAt: now,
  });
  const priorHistory = listDiagramRevisions(drawing);
  const boundedHistory = [...priorHistory, revision].slice(-Math.max(1, maxRevisions));
  const source = JSON.stringify(normalized.elements, null, 2);
  const priorVariant = drawing.variants?.excalidraw || {};

  return {
    ...cloneValue(drawing),
    engine: 'excalidraw',
    renderer: 'excalidraw',
    source,
    scene: normalized,
    revision: nextRevision,
    revisionHistory: boundedHistory,
    variants: {
      ...(drawing.variants || {}),
      excalidraw: {
        ...cloneValue(priorVariant),
        source,
        scene: normalized,
        revision: nextRevision,
        updatedAt: now,
      },
    },
    updatedAt: now,
  };
}

export function restoreDiagramRevision(drawing, revisionOrId, options = {}) {
  const revision = findDiagramRevision(drawing, revisionOrId);
  if (!revision) throw new Error(`Diagram revision not found: ${revisionOrId}`);
  return commitDiagramScene(drawing, revision.scene, {
    ...options,
    reason: options.reason || `restore:${revision.revision}`,
  });
}

