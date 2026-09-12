import { getDrawingScene } from './diagram-scene-record.js';

const FULL_DRAWING_FIELDS = new Set(['scene', 'source', 'history', 'revisionHistory', 'variants', 'presentation', 'namedSnapshots']);

function sceneBounds(elements) {
  const visible = elements.filter((element) => !element?.isDeleted);
  if (visible.length === 0) return null;
  const minX = Math.min(...visible.map((element) => Number(element.x) || 0));
  const minY = Math.min(...visible.map((element) => Number(element.y) || 0));
  const maxX = Math.max(...visible.map((element) => (Number(element.x) || 0) + (Number(element.width) || 0)));
  const maxY = Math.max(...visible.map((element) => (Number(element.y) || 0) + (Number(element.height) || 0)));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function createDiagramSummary(drawing) {
  const scene = getDrawingScene(drawing);
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const typeCounts = {};
  for (const element of elements) {
    if (element?.isDeleted) continue;
    const type = String(element?.type || 'unknown');
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  return {
    id: drawing.id,
    routeId: drawing.routeId,
    title: drawing.title,
    documentId: drawing.documentId,
    engine: drawing.engine,
    revision: drawing.revision || 0,
    updatedAt: drawing.updatedAt,
    elementCount: elements.filter((element) => !element?.isDeleted).length,
    deletedElementCount: elements.filter((element) => element?.isDeleted).length,
    typeCounts,
    bounds: sceneBounds(elements),
  };
}

export function projectDiagram(drawing, args = {}) {
  const include = new Set(Array.isArray(args.include) ? args.include.map(String) : []);
  if (args.projection === 'full') {
    for (const field of FULL_DRAWING_FIELDS) include.add(field);
  }
  const result = createDiagramSummary(drawing);
  for (const field of include) {
    if (field === 'scene') result.scene = getDrawingScene(drawing);
    else if (FULL_DRAWING_FIELDS.has(field) && drawing[field] !== undefined) result[field] = drawing[field];
  }
  return result;
}

function changedIdsFrom(command, result) {
  const ids = new Set();
  for (const id of result?.changedIds || []) ids.add(String(id));
  if (result?.element?.id) ids.add(String(result.element.id));
  for (const element of result?.elements || []) if (element?.id) ids.add(String(element.id));
  for (const item of command?.args?.elements || []) if (item?.id) ids.add(String(item.id));
  for (const item of command?.args?.updates || []) if (item?.elementId || item?.id) ids.add(String(item.elementId || item.id));
  for (const id of command?.args?.elementIds || command?.args?.ids || []) ids.add(String(id));
  for (const id of command?.args?.patch?.delete || []) ids.add(String(id));
  for (const item of command?.args?.patch?.create || []) if (item?.id) ids.add(String(item.id));
  for (const item of command?.args?.patch?.update || []) if (item?.id) ids.add(String(item.id));
  if (command?.args?.elementId) ids.add(String(command.args.elementId));
  return [...ids];
}

const MUTATION_TOOLS = new Set([
  'create_diagram', 'create_from_mermaid', 'create_element', 'batch_create_elements',
  'batch_update_elements', 'update_element', 'delete_element', 'clear_canvas',
  'set_presentation', 'clear_presentation', 'align_elements', 'distribute_elements',
  'group_elements', 'ungroup_elements', 'duplicate_elements', 'lock_elements',
  'unlock_elements', 'set_viewport', 'restore_snapshot', 'apply_diagram_patch',
  'commit_diagram_scene', 'restore_diagram_revision',
]);

export function projectDiagramAgentResult(command, result) {
  if (!MUTATION_TOOLS.has(String(command?.tool || '')) || !result || typeof result !== 'object') return result;
  const args = command?.args || {};
  const compact = {};
  const allowed = [
    'id', 'routeId', 'revision', 'operationRevision', 'operationId', 'idempotentReplay',
    'stableIdReplay',
    'conflictRetries', 'warnings', 'deleted', 'deletedCount', 'hardDelete', 'url',
    'openRequested', 'openAction', 'openTarget', 'openResource', 'presentationAutoPlayed',
    'stream', 'streamAutoPlayed', 'action', 'stepCount', 'stepIndex',
    'operationMetrics', 'groupId', 'snapshot',
  ];
  for (const key of allowed) if (result[key] !== undefined) compact[key] = result[key];
  if (!compact.operationId && args.operationId) compact.operationId = args.operationId;
  compact.changedIds = changedIdsFrom(command, result);
  if (args.includeScene === true && result.scene) compact.scene = result.scene;
  return compact;
}
