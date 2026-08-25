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
  return elements.map((element, index) => {
    if (!isRecord(element)) {
      throw new TypeError(`Excalidraw element at index ${index} must be an object.`);
    }
    return cloneValue(element);
  });
}

/** Normalize an element array without adding or removing element fields. */
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

