import { getElementBounds } from './excalidraw-scene-ops.js';
import { normalizeExcalidrawScene } from './excalidraw-scene.js';
import { normalizeMermaidSource } from './mermaid-render.js';

const DEFAULT_GAP = 120;
const DEFAULT_CONFIG = Object.freeze({
  startOnLoad: false,
  flowchart: { curve: 'linear' },
  themeVariables: { fontSize: '20px' },
  maxEdges: 500,
  maxTextSize: 50000,
});

function cloneValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function cleanId(value, fallback) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function createIdMap(elements, usedIds, prefix) {
  const idMap = new Map();
  const generatedIds = [];
  elements.forEach((element, index) => {
    const originalId = element?.id === undefined || element?.id === null
      ? ''
      : String(element.id);
    const base = `${cleanId(prefix, 'mermaid')}-${cleanId(originalId, element?.type || 'element')}-${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
    usedIds.add(candidate);
    generatedIds.push(candidate);
    // The converter emits unique ids. Keep the first mapping if a malformed
    // input repeats one, so bindings continue to target the first element.
    if (originalId && !idMap.has(originalId)) idMap.set(originalId, candidate);
  });
  return { idMap, generatedIds };
}

function remapBinding(binding, idMap) {
  if (!binding || typeof binding !== 'object') return binding;
  const next = { ...binding };
  if (next.elementId !== undefined && idMap.has(String(next.elementId))) {
    next.elementId = idMap.get(String(next.elementId));
  }
  if (next.id !== undefined && idMap.has(String(next.id))) next.id = idMap.get(String(next.id));
  return next;
}

function remapElement(element, index, idMap, generatedIds, groupMap, fileIdMap, offset) {
  const next = {
    ...cloneValue(element),
    id: idMap.get(String(element?.id)) || generatedIds[index] || `mermaid-element-${index + 1}`,
    x: finiteNumber(element?.x) + offset.x,
    y: finiteNumber(element?.y) + offset.y,
  };

  if (next.containerId !== undefined && next.containerId !== null) {
    next.containerId = idMap.get(String(next.containerId)) || null;
  }
  if (next.frameId !== undefined && next.frameId !== null) {
    next.frameId = idMap.get(String(next.frameId)) || null;
  }
  if (next.startBinding) next.startBinding = remapBinding(next.startBinding, idMap);
  if (next.endBinding) next.endBinding = remapBinding(next.endBinding, idMap);
  if (Array.isArray(next.boundElements)) {
    next.boundElements = next.boundElements.map((binding) => remapBinding(binding, idMap));
  }
  if (Array.isArray(next.groupIds)) {
    next.groupIds = next.groupIds.map((groupId) => groupMap.get(String(groupId)) || String(groupId));
  }
  if (next.fileId !== undefined && next.fileId !== null) {
    next.fileId = fileIdMap.get(String(next.fileId)) || next.fileId;
  }
  // Arrow and freedraw points are relative to the element origin.
  if (Array.isArray(next.points)) next.points = next.points.map((point) => [...point]);
  return next;
}

function createFileMap(files, usedFileIds, prefix) {
  const fileIdMap = new Map();
  const nextFiles = {};
  Object.entries(files || {}).forEach(([fileId, file]) => {
    const base = `${cleanId(prefix, 'mermaid')}-file-${cleanId(fileId, 'asset')}`;
    let candidate = base;
    let suffix = 2;
    while (usedFileIds.has(candidate)) candidate = `${base}-${suffix++}`;
    usedFileIds.add(candidate);
    fileIdMap.set(fileId, candidate);
    nextFiles[candidate] = cloneValue(file);
  });
  return { fileIdMap, files: nextFiles };
}

function createGroupMap(elements, usedGroupIds, prefix) {
  const groupMap = new Map();
  elements.flatMap((element) => Array.isArray(element?.groupIds) ? element.groupIds : [])
    .map((groupId) => String(groupId))
    .filter((groupId, index, all) => all.indexOf(groupId) === index)
    .forEach((groupId) => {
      const base = `${cleanId(prefix, 'mermaid')}-group-${cleanId(groupId, 'group')}`;
      let candidate = base;
      let suffix = 2;
      while (usedGroupIds.has(candidate)) candidate = `${base}-${suffix++}`;
      usedGroupIds.add(candidate);
      groupMap.set(groupId, candidate);
    });
  return groupMap;
}

function boundsForElements(elements) {
  if (!Array.isArray(elements) || elements.length === 0) return null;
  return elements.reduce((accumulator, element) => {
    const bounds = getElementBounds(element);
    if (!accumulator) return bounds;
    const x = Math.min(accumulator.x, bounds.x);
    const y = Math.min(accumulator.y, bounds.y);
    const maxX = Math.max(accumulator.maxX, bounds.maxX);
    const maxY = Math.max(accumulator.maxY, bounds.maxY);
    return { x, y, width: maxX - x, height: maxY - y, maxX, maxY };
  }, null);
}

function resolveOffset(existingBounds, importedBounds, position, gap) {
  if (!importedBounds) return { x: 0, y: 0 };
  if (!existingBounds) {
    return { x: gap - importedBounds.x, y: gap - importedBounds.y };
  }
  if (position === 'below') {
    return { x: existingBounds.x - importedBounds.x, y: existingBounds.maxY + gap - importedBounds.y };
  }
  if (position === 'center') {
    return {
      x: existingBounds.x + (existingBounds.width - importedBounds.width) / 2 - importedBounds.x,
      y: existingBounds.y + (existingBounds.height - importedBounds.height) / 2 - importedBounds.y,
    };
  }
  return { x: existingBounds.maxX + gap - importedBounds.x, y: existingBounds.y - importedBounds.y };
}

/**
 * Merge a converted Mermaid element set into a canonical Excalidraw scene.
 *
 * Imported ids, groups and file ids are namespaced to avoid silently
 * overwriting existing hand-edited content. Bindings and relative points are
 * retained, while imported elements are placed beside the current scene by
 * default. This function is pure and can be used by MCP, UI, or REST callers.
 */
export function mergeMermaidElementsIntoScene(baseScene, importedElements, importedFiles = {}, {
  position = 'right',
  gap = DEFAULT_GAP,
  idPrefix = 'mermaid',
} = {}) {
  const base = normalizeExcalidrawScene(baseScene ?? []);
  const imported = Array.isArray(importedElements) ? importedElements : [];
  if (imported.length === 0) return {
    scene: base,
    importedElementIds: [],
    idMap: {},
    fileIdMap: {},
    offset: { x: 0, y: 0 },
  };

  const usedIds = new Set(base.elements.map((element) => String(element?.id || '')).filter(Boolean));
  const usedGroupIds = new Set(base.elements.flatMap((element) => element?.groupIds || []).map(String));
  const usedFileIds = new Set(Object.keys(base.files || {}));
  const { idMap, generatedIds } = createIdMap(imported, usedIds, idPrefix);
  const groupMap = createGroupMap(imported, usedGroupIds, idPrefix);
  const { fileIdMap, files } = createFileMap(importedFiles, usedFileIds, idPrefix);
  const importedBounds = boundsForElements(imported);
  const existingBounds = boundsForElements(base.elements.filter((element) => !element?.isDeleted));
  const offset = resolveOffset(existingBounds, importedBounds, position, Math.max(0, finiteNumber(gap, DEFAULT_GAP)));
  const mergedElements = imported.map((element, index) => (
    remapElement(element, index, idMap, generatedIds, groupMap, fileIdMap, offset)
  ));

  const scene = normalizeExcalidrawScene({
    ...base,
    elements: [...base.elements, ...mergedElements],
    files: { ...base.files, ...files },
  });
  return {
    scene,
    importedElementIds: generatedIds,
    idMap: Object.fromEntries(idMap),
    fileIdMap: Object.fromEntries(fileIdMap),
    offset,
  };
}

/** Convert Mermaid source with the official browser-side converter. */
export async function convertMermaidToExcalidrawScene(source, {
  baseScene = [],
  config = {},
  position = 'right',
  gap = DEFAULT_GAP,
  idPrefix = 'mermaid',
} = {}) {
  const definition = normalizeMermaidSource(source);
  if (!definition) throw new Error('Mermaid source is empty.');
  // The converter depends on DOM APIs and must stay out of SSR/MCP Node paths.
  const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');
  const result = await parseMermaidToExcalidraw(definition, { ...DEFAULT_CONFIG, ...config });
  return mergeMermaidElementsIntoScene(baseScene, result.elements, result.files, {
    position,
    gap,
    idPrefix,
  });
}

export { DEFAULT_CONFIG as DEFAULT_MERMAID_EXCALIDRAW_CONFIG };
