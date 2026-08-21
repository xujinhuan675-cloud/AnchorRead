import {
  createResourceRouteId,
  ensureResourceRouteId,
  getResourceRouteId,
  isResourceRouteId,
  normalizeResourceRouteIds,
} from './resource-route-id.js';

const DIAGRAM_ROUTE_ID_PREFIX = 'dg';

export function isDiagramRouteId(value) {
  return isResourceRouteId(value, DIAGRAM_ROUTE_ID_PREFIX);
}

export function createDiagramRouteId(existingRouteIds = new Set()) {
  return createResourceRouteId(DIAGRAM_ROUTE_ID_PREFIX, existingRouteIds);
}

export function getDiagramRouteId(drawing) {
  return getResourceRouteId(drawing, DIAGRAM_ROUTE_ID_PREFIX);
}

export function ensureDiagramRouteId(drawing, existingRouteIds = new Set()) {
  return ensureResourceRouteId(drawing, DIAGRAM_ROUTE_ID_PREFIX, existingRouteIds);
}

export function normalizeDiagramRouteIds(drawings = []) {
  return normalizeResourceRouteIds(drawings, DIAGRAM_ROUTE_ID_PREFIX);
}
