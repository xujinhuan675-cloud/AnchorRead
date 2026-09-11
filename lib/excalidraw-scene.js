import { normalizePersistedExcalidrawAppState } from './excalidraw-app-state.js';

/**
 * Excalidraw scene interchange helpers.
 *
 * Anchor Read historically stores Excalidraw source as a JSON array of
 * elements. The native .excalidraw format is a scene object containing the
 * same elements plus appState and files. This module keeps both formats
 * readable while providing one canonical representation for new integrations.
 */

export const EXCALIDRAW_SCENE_TYPE = 'excalidraw';
export const EXCALIDRAW_SCENE_VERSION = 2;
export const EXCALIDRAW_SOURCE = 'anchor-read';

const DEFAULT_APP_STATE = Object.freeze({
  viewBackgroundColor: '#ffffff',
  gridSize: null,
  exportBackground: true,
});

function cloneValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundElementId(element, edge) {
  const direct = element?.[`${edge}ElementId`];
  const alias = element?.[edge]?.id;
  const binding = element?.[`${edge}Binding`]?.elementId;
  const value = direct ?? alias ?? binding;
  return value === undefined || value === null || !String(value).trim()
    ? null
    : String(value);
}

function elementBox(element) {
  if (![element?.x, element?.y, element?.width, element?.height].every(Number.isFinite)) {
    return null;
  }
  const left = Math.min(element.x, element.x + element.width);
  const right = Math.max(element.x, element.x + element.width);
  const top = Math.min(element.y, element.y + element.height);
  const bottom = Math.max(element.y, element.y + element.height);
  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function boxBoundaryPoint(box, dx, dy) {
  const halfWidth = (box.right - box.left) / 2;
  const halfHeight = (box.bottom - box.top) / 2;
  const xScale = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const yScale = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const scale = Math.min(xScale, yScale);
  if (!Number.isFinite(scale)) return null;
  return [box.centerX + dx * scale, box.centerY + dy * scale];
}

function resolveBoundLinearGeometry(elements) {
  const elementMap = new Map(elements.filter((element) => element?.id).map((element) => [String(element.id), element]));
  return elements.map((element) => {
    if (element?.type !== 'arrow' && element?.type !== 'line') return element;
    if (Number.isFinite(element.x) && Number.isFinite(element.y)) return element;

    const start = elementBox(elementMap.get(boundElementId(element, 'start')));
    const end = elementBox(elementMap.get(boundElementId(element, 'end')));
    if (!start || !end) return element;
    const dx = end.centerX - start.centerX;
    const dy = end.centerY - start.centerY;
    if (dx === 0 && dy === 0) return element;

    const from = boxBoundaryPoint(start, dx, dy);
    const to = boxBoundaryPoint(end, -dx, -dy);
    if (!from || !to) return element;
    const lineDx = to[0] - from[0];
    const lineDy = to[1] - from[1];
    return {
      ...element,
      x: from[0],
      y: from[1],
      width: Math.abs(lineDx),
      height: Math.abs(lineDy),
      points: [[0, 0], [lineDx, lineDy]],
    };
  });
}

function parseJsonText(value) {
  const text = String(value ?? '').replace(/^\uFEFF/u, '').trim();
  if (!text) throw new Error('Excalidraw source is empty.');

  try {
    return JSON.parse(text);
  } catch (error) {
    // A pasted response may still contain a markdown JSON fence. Accept it
    // without making the normal .excalidraw JSON path more permissive.
    const fenced = text.match(/```(?:json|excalidraw)?\s*\n?([\s\S]*?)\n?```/iu);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // Fall through to the original parse error for a useful message.
      }
    }
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`Excalidraw source is not valid JSON${detail}`);
  }
}

function parseInput(value) {
  return typeof value === 'string' ? parseJsonText(value) : cloneValue(value);
}

function assertElements(elements) {
  if (!Array.isArray(elements)) {
    throw new TypeError('Excalidraw scene must contain an elements array.');
  }
  const normalizedElements = elements.map((element, index) => {
    if (!isRecord(element)) {
      throw new TypeError(`Excalidraw element at index ${index} must be an object.`);
    }
    const normalized = cloneValue(element);

    // The external MCP accepts both {x, y} points and Excalidraw's [x, y]
    // tuples. Normalize the former at the scene boundary so bounds, export,
    // and browser conversion all see the same geometry without dropping
    // unknown element fields.
    if (Array.isArray(normalized.points)) {
      normalized.points = normalized.points.map((point) => {
        if (Array.isArray(point) && point.length >= 2) return [...point];
        if (isRecord(point) && Number.isFinite(point.x) && Number.isFinite(point.y)) {
          return [point.x, point.y];
        }
        return point;
      });
    }

    // yctimlin/mcp_excalidraw uses startElementId/endElementId as its
    // agent-friendly binding shorthand. Keep those aliases for round trips,
    // while exposing the { id } shape consumed by AnchorRead's browser bridge.
    if (normalized.startElementId !== undefined && normalized.startElementId !== null
      && String(normalized.startElementId).trim() && normalized.start === undefined) {
      normalized.start = { id: String(normalized.startElementId) };
    }
    if (normalized.endElementId !== undefined && normalized.endElementId !== null
      && String(normalized.endElementId).trim() && normalized.end === undefined) {
      normalized.end = { id: String(normalized.endElementId) };
    }

    // Bound arrows without points need a visible default segment. The
    // external server uses 100x0 when no geometry is supplied; match that
    // convention while retaining explicit width/height when present.
    const hasExternalBinding = Boolean(
      normalized.start
      || normalized.end
      || (normalized.startElementId !== undefined && normalized.startElementId !== null
        && String(normalized.startElementId).trim())
      || (normalized.endElementId !== undefined && normalized.endElementId !== null
        && String(normalized.endElementId).trim()),
    );
    if ((normalized.type === 'arrow' || normalized.type === 'line')
      && !Array.isArray(normalized.points) && hasExternalBinding) {
      normalized.points = [[0, 0], [
        Number.isFinite(normalized.width) && normalized.width !== 0 ? normalized.width : 100,
        Number.isFinite(normalized.height) ? normalized.height : 0,
      ]];
    }

    return normalized;
  });
  return resolveBoundLinearGeometry(normalizedElements);
}

/** Normalize an element array while preserving unknown element fields. */
export function normalizeExcalidrawElements(elements) {
  return assertElements(elements);
}

/**
 * Normalize appState while retaining fields introduced by newer Excalidraw
 * versions. Defaults are only applied when a value is absent.
 */
export function normalizeExcalidrawAppState(appState) {
  if (appState === undefined || appState === null) return { ...DEFAULT_APP_STATE };
  if (!isRecord(appState)) {
    throw new TypeError('Excalidraw appState must be an object.');
  }
  return {
    ...DEFAULT_APP_STATE,
    ...cloneValue(appState),
  };
}

/** Normalize the binary/image file map used by Excalidraw scenes. */
export function normalizeExcalidrawFiles(files) {
  if (files === undefined || files === null) return {};
  if (!isRecord(files)) {
    throw new TypeError('Excalidraw files must be an object map.');
  }
  return cloneValue(files);
}

function classifyParsedValue(parsed) {
  if (Array.isArray(parsed)) return 'elements';
  if (isRecord(parsed) && Array.isArray(parsed.elements)) return 'scene';
  return 'invalid';
}

/**
 * Detect whether a value is legacy element-array JSON or a complete scene.
 * Invalid input is reported as "invalid" instead of throwing so callers can
 * use this for file-picker validation.
 */
export function detectExcalidrawFormat(value) {
  try {
    return classifyParsedValue(parseInput(value));
  } catch {
    return 'invalid';
  }
}

export const detectExcalidrawSourceFormat = detectExcalidrawFormat;

export function isExcalidrawScene(value) {
  return detectExcalidrawFormat(value) === 'scene';
}

export function isExcalidrawElements(value) {
  return detectExcalidrawFormat(value) === 'elements';
}

/**
 * Convert either legacy element-array JSON or a native scene into the
 * canonical scene shape consumed by import/export code.
 */
export function normalizeExcalidrawScene(value, {
  source = EXCALIDRAW_SOURCE,
} = {}) {
  const parsed = parseInput(value);
  const format = classifyParsedValue(parsed);
  if (format === 'invalid') {
    throw new TypeError('Excalidraw source must be an elements array or a scene object.');
  }

  const sourceScene = format === 'scene' ? parsed : {};
  const elements = normalizeExcalidrawElements(
    format === 'elements' ? parsed : sourceScene.elements
  );
  const normalized = {
    ...cloneValue(sourceScene),
    type: EXCALIDRAW_SCENE_TYPE,
    version: EXCALIDRAW_SCENE_VERSION,
    source: typeof sourceScene.source === 'string' && sourceScene.source.trim()
      ? sourceScene.source
      : source,
    elements,
    appState: normalizeExcalidrawAppState(sourceScene.appState),
    files: normalizeExcalidrawFiles(sourceScene.files),
  };
  return normalized;
}

/**
 * Normalize a live Excalidraw callback for persistence. Runtime app state can
 * contain React elements (for example while the context menu is open), which
 * are not structured-cloneable and are not part of the saved drawing anyway.
 */
export function normalizeExcalidrawSceneForPersistence(value) {
  if (!isRecord(value) || !Array.isArray(value.elements)) {
    throw new TypeError('Excalidraw scene must contain an elements array.');
  }
  return normalizeExcalidrawScene({
    elements: value.elements,
    appState: normalizePersistedExcalidrawAppState(value.appState),
    files: value.files,
  });
}

/** Parse and normalize a JSON string, object, or legacy element array. */
export function parseExcalidrawScene(value, options) {
  return normalizeExcalidrawScene(value, options);
}

/** Serialize a complete, normalized .excalidraw scene as JSON text. */
export function serializeExcalidrawScene(value, {
  space = 2,
  ...options
} = {}) {
  const scene = normalizeExcalidrawScene(value, options);
  return JSON.stringify(scene, null, space);
}

/** Alias useful at file boundaries where the output is explicitly source text. */
export const serializeExcalidrawSource = serializeExcalidrawScene;

export function getExcalidrawSceneElements(value) {
  return normalizeExcalidrawScene(value).elements;
}
