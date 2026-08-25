/**
 * Pure scene operations for Excalidraw-compatible element data.
 *
 * The functions in this module do not know about React, IndexedDB, or a
 * canvas server. They accept either an element array or a scene object and
 * always return cloned data so callers can decide how and when to persist it.
 */

function cloneValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function asNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function getSceneParts(scene) {
  if (Array.isArray(scene)) {
    return {
      isArray: true,
      elements: cloneValue(scene),
      appState: {},
      files: {},
    };
  }

  if (!scene || typeof scene !== 'object' || !Array.isArray(scene.elements)) {
    throw new TypeError('Expected an Excalidraw element array or scene with an elements array');
  }

  return {
    isArray: false,
    original: scene,
    elements: cloneValue(scene.elements),
    appState: cloneValue(scene.appState ?? {}),
    files: cloneValue(scene.files ?? {}),
  };
}

function withSceneShape(original, parts) {
  if (parts.isArray) return parts.elements;
  return {
    ...cloneValue(parts.original),
    elements: parts.elements,
    appState: parts.appState,
    files: parts.files,
  };
}

function normalizeIds(ids) {
  if (ids === undefined || ids === null) return null;
  const values = Array.isArray(ids) ? ids : [ids];
  return new Set(values.map((id) => String(id)));
}

function elementLabel(element) {
  return [element?.text, element?.originalText, element?.label?.text]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' ');
}

function numericDimension(value) {
  return Math.abs(asNumber(value));
}

/** Return an axis-aligned bounding box, including arrow points when present. */
export function getElementBounds(element) {
  if (!element || typeof element !== 'object') {
    throw new TypeError('Expected an Excalidraw element');
  }

  const x = asNumber(element.x);
  const y = asNumber(element.y);
  const width = numericDimension(element.width);
  const height = numericDimension(element.height);
  const points = Array.isArray(element.points) ? element.points : [];
  const coordinates = [[x, y], [x + width, y + height]];

  for (const point of points) {
    if (Array.isArray(point) && point.length >= 2) {
      coordinates.push([x + asNumber(point[0]), y + asNumber(point[1])]);
    }
  }

  const xs = coordinates.map(([pointX]) => pointX);
  const ys = coordinates.map(([, pointY]) => pointY);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    maxX,
    maxY,
  };
}

function boundsFromFilter(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const x = asNumber(bounds.x);
  const y = asNumber(bounds.y);
  const width = numericDimension(bounds.width);
  const height = numericDimension(bounds.height);
  return { x, y, width, height, maxX: x + width, maxY: y + height };
}

function intersects(a, b) {
  return a.x <= b.maxX && a.maxX >= b.x && a.y <= b.maxY && a.maxY >= b.y;
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;
}

/**
 * Query active scene elements by stable fields. Text matching is
 * case-insensitive by default and bounds use intersection semantics.
 */
export function querySceneElements(scene, filters = {}) {
  const { elements } = getSceneParts(scene);
  const ids = normalizeIds(filters.ids ?? filters.id);
  const types = normalizeIds(filters.types ?? filters.type);
  const bounds = boundsFromFilter(filters.bounds);
  const textFilter = filters.text;
  const includeDeleted = filters.includeDeleted === true;
  const matchMode = filters.boundsMode === 'contains' ? 'contains' : 'intersects';

  return elements.filter((element) => {
    if (!includeDeleted && element.isDeleted === true) return false;
    if (ids && !ids.has(String(element.id))) return false;
    if (types && !types.has(String(element.type))) return false;
    if (filters.locked !== undefined && Boolean(element.locked) !== Boolean(filters.locked)) {
      return false;
    }
    if (filters.groupId !== undefined
      && !(Array.isArray(element.groupIds) && element.groupIds.includes(filters.groupId))) {
      return false;
    }
    if (textFilter !== undefined) {
      const label = elementLabel(element);
      if (textFilter instanceof RegExp) {
        textFilter.lastIndex = 0;
        if (!textFilter.test(label)) return false;
      } else if (!label.toLocaleLowerCase().includes(String(textFilter).toLocaleLowerCase())) {
        return false;
      }
    }
    if (bounds) {
      const elementBounds = getElementBounds(element);
      if (matchMode === 'contains' ? !contains(bounds, elementBounds) : !intersects(elementBounds, bounds)) {
        return false;
      }
    }
    return true;
  }).map((element) => cloneValue(element));
}

/** Build a deterministic, AI-readable description of a scene. */
export function describeScene(scene, { maxElements = Infinity, includeDeleted = false } = {}) {
  const elements = querySceneElements(scene, { includeDeleted });
  if (elements.length === 0) return 'The canvas is empty. No elements to describe.';

  const typeCounts = {};
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const element of elements) {
    typeCounts[element.type] = (typeCounts[element.type] || 0) + 1;
    const bounds = getElementBounds(element);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  const sorted = [...elements].sort((a, b) => {
    const rowDiff = Math.floor(asNumber(a.y) / 50) - Math.floor(asNumber(b.y) / 50);
    return rowDiff !== 0 ? rowDiff : asNumber(a.x) - asNumber(b.x);
  });
  const elementLines = sorted.slice(0, maxElements).map((element) => {
    const bounds = getElementBounds(element);
    const parts = [
      `[${element.id}] ${element.type}`,
      `at (${Math.round(bounds.x)}, ${Math.round(bounds.y)})`,
      `size ${Math.round(bounds.width)}x${Math.round(bounds.height)}`,
    ];
    const text = elementLabel(element);
    if (text) parts.push(`text: "${text}"`);
    if (element.backgroundColor && element.backgroundColor !== 'transparent') {
      parts.push(`bg: ${element.backgroundColor}`);
    }
    if (element.strokeColor) parts.push(`stroke: ${element.strokeColor}`);
    if (element.locked) parts.push('(locked)');
    if (Array.isArray(element.groupIds) && element.groupIds.length > 0) {
      parts.push(`groups: [${element.groupIds.join(', ')}]`);
    }
    if (element.isDeleted) parts.push('(deleted)');
    return `  ${parts.join(' | ')}`;
  });

  const lines = [
    '## Canvas Description',
    `Total elements: ${elements.length}`,
    `Types: ${Object.entries(typeCounts).map(([type, count]) => `${type}(${count})`).join(', ')}`,
    `Bounding box: (${Math.round(minX)}, ${Math.round(minY)}) to (${Math.round(maxX)}, ${Math.round(maxY)}) = ${Math.round(maxX - minX)}x${Math.round(maxY - minY)}`,
    '',
    '### Elements (top-to-bottom, left-to-right):',
    ...elementLines,
  ];
  if (elements.length > elementLines.length) lines.push(`  ... ${elements.length - elementLines.length} more elements`);

  const connections = elements
    .filter((element) => element.type === 'arrow')
    .map((arrow) => {
      const from = arrow.startBinding?.elementId || '?';
      const to = arrow.endBinding?.elementId || '?';
      return from !== '?' || to !== '?' ? `  ${from} --> ${to} (arrow: ${arrow.id})` : null;
    })
    .filter(Boolean);
  if (connections.length > 0) lines.push('', '### Connections:', ...connections);

  const groups = new Map();
  for (const element of elements) {
    for (const groupId of element.groupIds || []) {
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(element.id);
    }
  }
  if (groups.size > 0) {
    lines.push('', '### Groups:');
    for (const [groupId, ids] of groups) lines.push(`  Group ${groupId}: [${ids.join(', ')}]`);
  }

  return lines.join('\n');
}

/** Create a detached named snapshot that can safely be persisted elsewhere. */
export function createSceneSnapshot(scene, {
  name = 'snapshot',
  id = name,
  createdAt = Date.now(),
} = {}) {
  const parts = getSceneParts(scene);
  return {
    id,
    name,
    version: 1,
    elements: cloneValue(parts.elements),
    appState: cloneValue(parts.appState),
    files: cloneValue(parts.files),
    createdAt,
  };
}

/** Restore a snapshot into a fresh scene object. */
export function restoreSceneSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.elements)) {
    throw new TypeError('Expected a scene snapshot with an elements array');
  }
  return {
    elements: cloneValue(snapshot.elements),
    appState: cloneValue(snapshot.appState ?? {}),
    files: cloneValue(snapshot.files ?? {}),
  };
}

function ensurePatchId(id, label) {
  if (id === undefined || id === null || String(id).length === 0) {
    throw new TypeError(`${label} requires an element id`);
  }
  return String(id);
}

/** Apply immutable element CRUD operations, preserving the caller's scene shape. */
export function applyScenePatch(scene, patch = {}, { hardDelete = false } = {}) {
  const parts = getSceneParts(scene);
  const elements = parts.elements;
  const byId = new Map(elements.map((element, index) => [String(element.id ?? index), element]));

  for (const element of patch.create ?? patch.add ?? []) {
    const id = ensurePatchId(element?.id, 'create');
    if (byId.has(id)) throw new Error(`Cannot create duplicate element id: ${id}`);
    const created = cloneValue({ ...element, id });
    byId.set(id, created);
    elements.push(created);
  }

  for (const update of patch.update ?? []) {
    const id = ensurePatchId(update?.id, 'update');
    const current = byId.get(id);
    if (!current) throw new Error(`Cannot update missing element: ${id}`);
    const { id: ignoredId, ...changes } = update;
    const next = { ...current, ...cloneValue(changes), id };
    const index = elements.indexOf(current);
    elements[index] = next;
    byId.set(id, next);
  }

  for (const rawId of patch.delete ?? patch.remove ?? []) {
    const id = ensurePatchId(rawId, 'delete');
    const current = byId.get(id);
    if (!current) throw new Error(`Cannot delete missing element: ${id}`);
    if (hardDelete) {
      elements.splice(elements.indexOf(current), 1);
      byId.delete(id);
    } else {
      const deleted = { ...current, isDeleted: true };
      elements[elements.indexOf(current)] = deleted;
      byId.set(id, deleted);
    }
  }

  parts.elements = elements;
  return withSceneShape(scene, parts);
}

function selectedElements(parts, ids, operation) {
  const idSet = normalizeIds(ids);
  if (!idSet || idSet.size < 2) throw new Error(`${operation} requires at least 2 element ids`);
  const selected = parts.elements.filter((element) => idSet.has(String(element.id)) && !element.isDeleted);
  if (selected.length !== idSet.size) throw new Error(`${operation} could not find every requested element`);
  return selected;
}

/** Align selected elements without mutating the source scene. */
export function alignScene(scene, { ids, alignment = 'left' } = {}) {
  const parts = getSceneParts(scene);
  const selected = selectedElements(parts, ids, 'align');
  const allowed = new Set(['left', 'center', 'right', 'top', 'middle', 'bottom']);
  if (!allowed.has(alignment)) throw new Error(`Unsupported alignment: ${alignment}`);
  const bounds = selected.map((element) => ({ element, bounds: getElementBounds(element) }));
  const updates = [];

  if (alignment === 'left') {
    const target = Math.min(...bounds.map(({ bounds: item }) => item.x));
    for (const item of bounds) updates.push({ id: item.element.id, x: target });
  } else if (alignment === 'right') {
    const target = Math.max(...bounds.map(({ bounds: item }) => item.maxX));
    for (const item of bounds) updates.push({ id: item.element.id, x: target - item.bounds.width });
  } else if (alignment === 'center') {
    const target = bounds.reduce((sum, item) => sum + item.bounds.x + item.bounds.width / 2, 0) / bounds.length;
    for (const item of bounds) updates.push({ id: item.element.id, x: target - item.bounds.width / 2 });
  } else if (alignment === 'top') {
    const target = Math.min(...bounds.map(({ bounds: item }) => item.y));
    for (const item of bounds) updates.push({ id: item.element.id, y: target });
  } else if (alignment === 'bottom') {
    const target = Math.max(...bounds.map(({ bounds: item }) => item.maxY));
    for (const item of bounds) updates.push({ id: item.element.id, y: target - item.bounds.height });
  } else {
    const target = bounds.reduce((sum, item) => sum + item.bounds.y + item.bounds.height / 2, 0) / bounds.length;
    for (const item of bounds) updates.push({ id: item.element.id, y: target - item.bounds.height / 2 });
  }

  return applyScenePatch(scene, { update: updates });
}

/** Distribute selected elements evenly across their existing outer span. */
export function distributeScene(scene, { ids, direction = 'horizontal' } = {}) {
  const parts = getSceneParts(scene);
  const selected = selectedElements(parts, ids, 'distribute');
  if (selected.length < 3) throw new Error('distribute requires at least 3 element ids');
  if (direction !== 'horizontal' && direction !== 'vertical') {
    throw new Error(`Unsupported distribution direction: ${direction}`);
  }

  const items = selected.map((element) => ({ element, bounds: getElementBounds(element) }));
  const axis = direction === 'horizontal' ? 'x' : 'y';
  const size = direction === 'horizontal' ? 'width' : 'height';
  items.sort((a, b) => a.bounds[axis] - b.bounds[axis]);
  const first = items[0].bounds[axis];
  const last = items[items.length - 1].bounds[axis] + items[items.length - 1].bounds[size];
  const totalSize = items.reduce((sum, item) => sum + item.bounds[size], 0);
  const gap = (last - first - totalSize) / (items.length - 1);
  let cursor = first;
  const updates = [];
  for (const item of items) {
    updates.push({ id: item.element.id, [axis]: cursor });
    cursor += item.bounds[size] + gap;
  }
  return applyScenePatch(scene, { update: updates });
}
